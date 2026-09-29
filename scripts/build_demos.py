#!/usr/bin/env python3
"""Рисованные демонстрации упражнений: человечек в одежде, зацикленный повтор.

Не видео с человеком, а подсказка «куда двигаться»: линия спины, траектория снаряда,
что сгибается, а что остаётся неподвижным. Своих медиа мы не хостим (ADR-014) — эти
гифки лежат в репозитории и уходят в сборку воркера, поэтому каждый килобайт на счету:
палитра короткая, фон плоский, паузы склеиваются в один кадр.

Чтобы схема читалась как человек, а не как механизм:

- у тела есть объём — бёдра толще голеней, грудная клетка глубже талии, есть кисти,
  стопы, волосы и нос, по которым видно, куда смотрит лицо;
- ближние рука и нога яркие, дальние — бледные: в профиль видно, что конечностей две;
- повтор идёт в живом темпе, а не синусоидой: разгон и торможение по кривой
  минимального рывка (так двигается рука человека), пауза в крайней точке, уступающая
  фаза медленнее преодолевающей — как в технике упражнения;
- части тела не движутся строго синхронно: гиря в свинге отстаёт от таза, руки
  в приседе догоняют корпус, грудь дышит в удержаниях.

Схема есть у каждого упражнения из шаблонов дней и лестниц — карточка тренировки
показывает её сама, без отдельной команды (docs/04-bot-ux.md).

Запуск: python3 scripts/build_demos.py  → assets/demos/<КОД>.gif
"""

from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass, field
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = "assets/demos"

# Рисуем с запасом и уменьшаем: у Pillow нет сглаживания линий.
SUPERSAMPLE = 3
SIZE = 240
# Петля ~2,9 с: повтор с паузами в живом темпе, а не рывок туда-обратно за секунду.
FRAMES = 32
FRAME_MS = 90
# Ниже этого числа различных кадров гифка перестаёт быть анимацией для Telegram.
MIN_UNIQUE_FRAMES = 6

BG = (250, 249, 246)
INK = (40, 42, 48)
SKIN = (221, 168, 132)
SKIN_FAR = (238, 210, 188)
HAIR = (84, 60, 46)
SHIRT = (62, 104, 152)
SHIRT_FAR = (166, 188, 214)
PANTS = (60, 64, 78)
PANTS_FAR = (164, 168, 180)
MUTED = (196, 193, 186)
SHADOW = (228, 225, 218)
ACCENT = (206, 84, 52)

# Пропорции тела в метрах на рост ~1,75.
SHIN = 0.44
THIGH = 0.40
TORSO = 0.52
UPPER_ARM = 0.30
FOREARM = 0.28
HEAD_R = 0.105
NECK = 0.07
LEG = THIGH + SHIN
ARM = UPPER_ARM + FOREARM
BODY = TORSO + LEG

Point = tuple[float, float]


# --- Геометрия --------------------------------------------------------------


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_pt(a: Point, b: Point, t: float) -> Point:
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t))


def add(a: Point, b: Point, k: float = 1.0) -> Point:
    return (a[0] + b[0] * k, a[1] + b[1] * k)


def unit(a: Point, b: Point) -> Point:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1e-6
    return (dx / length, dy / length)


def rot(v: Point, deg: float) -> Point:
    a = math.radians(deg)
    return (v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a))


def polar(origin: Point, angle_deg: float, length: float) -> Point:
    a = math.radians(angle_deg)
    return (origin[0] + math.cos(a) * length, origin[1] + math.sin(a) * length)


def angle_of(a: Point, b: Point) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def straight_arm(shoulder: Point, angle_deg: float, factor: float = 0.985) -> Point:
    """Запястье на прямой руке: свинг и румынская тяга руками не тянут."""
    return polar(shoulder, angle_deg, ARM * factor)


def ik(root: Point, target: Point, l1: float, l2: float, bend: float) -> Point:
    """Сустав между двумя звеньями. `bend` = +1 или −1 — в какую сторону колено/локоть."""
    dx, dy = target[0] - root[0], target[1] - root[1]
    dist = math.hypot(dx, dy)
    reach = l1 + l2 - 1e-6
    if dist > reach:
        scale = reach / max(dist, 1e-6)
        dx, dy, dist = dx * scale, dy * scale, reach
    dist = max(dist, 1e-6)
    ux, uy = dx / dist, dy / dist
    x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    mid = (root[0] + ux * x, root[1] + uy * x)
    return (mid[0] - uy * h * bend, mid[1] + ux * h * bend)


def ik_toward(root: Point, target: Point, l1: float, l2: float, prefer: Point) -> Point:
    """Тот же сустав, но сторону выбирает направление: «локти наружу», «колени вперёд»."""
    a = ik(root, target, l1, l2, 1.0)
    b = ik(root, target, l1, l2, -1.0)
    da = (a[0] - root[0]) * prefer[0] + (a[1] - root[1]) * prefer[1]
    db = (b[0] - root[0]) * prefer[0] + (b[1] - root[1]) * prefer[1]
    return a if da >= db else b


def profile_at(points: list[tuple[float, ...]], s: float) -> tuple[float, ...]:
    """Значение профиля толщины в точке s: плавно между опорными точками."""
    if s <= points[0][0]:
        return points[0][1:]
    for left, right in zip(points, points[1:]):
        if s <= right[0]:
            k = (s - left[0]) / (right[0] - left[0])
            k = 0.5 - 0.5 * math.cos(math.pi * k)
            return tuple(lerp(x, y, k) for x, y in zip(left[1:], right[1:]))
    return points[-1][1:]


# --- Темп -------------------------------------------------------------------


def min_jerk(x: float) -> float:
    """Кривая минимального рывка: так разгоняется и тормозит рука живого человека."""
    x = min(1.0, max(0.0, x))
    return x * x * x * (10 - 15 * x + 6 * x * x)


def rep(t: float, go: float, hold: float, back: float, lag: float = 0.0) -> float:
    """Один повтор: 0 → 1, пауза, 1 → 0. Доли петли на каждую фазу, остаток — пауза в исходной.

    `lag` сдвигает фазу: так одна часть тела догоняет другую, а не едет с ней в ногу.
    """
    t = (t - lag) % 1.0
    t -= max(0.0, 1.0 - go - hold - back) * 0.5
    if t < 0:
        return 0.0
    if t < go:
        return min_jerk(t / go)
    t -= go
    if t < hold:
        return 1.0
    t -= hold
    if t < back:
        return 1.0 - min_jerk(t / back)
    return 0.0


def lower(t: float, lag: float = 0.0) -> float:
    """Сначала уступающая фаза: вниз медленно, короткая пауза, вверх бодрее."""
    return rep(t, 0.40, 0.08, 0.28, lag)


def lift(t: float, lag: float = 0.0) -> float:
    """Сначала преодолевающая фаза: вверх бодро, пауза, вниз в полтора раза медленнее."""
    return rep(t, 0.26, 0.14, 0.40, lag)


def settle(t: float, lag: float = 0.0) -> float:
    """Растяжки и удержания: плавно войти, подышать в позиции, выйти."""
    return rep(t, 0.30, 0.34, 0.26, lag)


def effort(t: float) -> float:
    """Изометрия: усилие нарастает, держится и отпускается — снаружи движения почти нет."""
    return rep(t, 0.22, 0.46, 0.18)


def pendulum(t: float, lag: float = 0.0) -> float:
    """Баллистика без пауз: свинг не останавливается ни наверху, ни внизу."""
    return rep(t, 0.46, 0.02, 0.46, lag)


def breath(t: float) -> float:
    return math.sin(2 * math.pi * t)


def tremor(t: float) -> float:
    """Мелкая дрожь напряжённой мышцы: у изометрии больше нечего показать глазу."""
    return math.sin(12 * math.pi * t) * 0.6 + math.sin(18 * math.pi * t + 1.0) * 0.4


# --- Холст ------------------------------------------------------------------

FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


@dataclass
class Camera:
    """Кадрирование: у стоячих, лежачих и «по пояс» упражнений оно разное."""

    origin_x: float = 0.42
    origin_y: float = 0.88
    zoom: float = 1.0
    # Пол рисуется не везде: у вида сверху и крупного плана его нет.
    ground: bool = True


@dataclass
class Tone:
    skin: tuple[int, int, int]
    shirt: tuple[int, int, int]
    pants: tuple[int, int, int]
    shoe: tuple[int, int, int]
    bell: tuple[int, int, int]


NEAR = Tone(SKIN, SHIRT, PANTS, INK, INK)
FAR = Tone(SKIN_FAR, SHIRT_FAR, PANTS_FAR, PANTS_FAR, PANTS_FAR)


class Canvas:
    def __init__(self, camera: Camera | None = None) -> None:
        camera = camera or Camera()
        self.px = SIZE * SUPERSAMPLE
        self.image = Image.new("RGB", (self.px, self.px), BG)
        self.draw = ImageDraw.Draw(self.image)
        # Метр: фигура ростом ~1.75 занимает примерно 78% высоты кадра.
        self.scale = self.px * 0.78 / 1.75 * camera.zoom
        self.origin = (self.px * camera.origin_x, self.px * camera.origin_y)

    def to_px(self, point: Point) -> tuple[float, float]:
        return (self.origin[0] + point[0] * self.scale, self.origin[1] - point[1] * self.scale)

    def disc(self, center: Point, radius: float, color) -> None:
        c = self.to_px(center)
        r = radius * self.scale
        self.draw.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=color)

    def ring(self, center: Point, radius: float, width: float, color) -> None:
        c = self.to_px(center)
        r = radius * self.scale
        self.draw.ellipse(
            [c[0] - r, c[1] - r, c[0] + r, c[1] + r],
            outline=color,
            width=max(2, int(width * self.scale)),
        )

    def poly(self, points: list[Point], color) -> None:
        self.draw.polygon([self.to_px(p) for p in points], fill=color)

    def oval(self, center: Point, rx: float, ry: float, angle_deg: float, color) -> None:
        """Эллипс под углом: у Pillow эллипсы только по осям."""
        up = rot((0.0, 1.0), angle_deg)
        side = (up[1], -up[0])
        points = []
        for index in range(28):
            a = 2 * math.pi * index / 28
            points.append(add(add(center, side, math.cos(a) * rx), up, math.sin(a) * ry))
        self.poly(points, color)

    def limb(self, a: Point, b: Point, radii: list[tuple[float, float]], color, gap: float = 0.0) -> None:
        """Сегмент тела с профилем толщины: бедро толще у таза, икра утолщается под коленом.

        `gap` — светлая обводка: рука поверх корпуса того же цвета иначе в нём тонет.
        """
        if gap:
            self.limb(a, b, [(s, r + gap) for s, r in radii], BG)
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy) or 1e-6
        nx, ny = -dy / length, dx / length
        left: list[Point] = []
        right: list[Point] = []
        for index in range(13):
            s = index / 12
            (r,) = profile_at(radii, s)
            c = (a[0] + dx * s, a[1] + dy * s)
            left.append((c[0] + nx * r, c[1] + ny * r))
            right.append((c[0] - nx * r, c[1] - ny * r))
        self.poly(left + right[::-1], color)
        self.disc(a, radii[0][1], color)
        self.disc(b, radii[-1][1], color)

    def bone(self, a: Point, b: Point, width: float, color) -> None:
        self.limb(a, b, [(0.0, width / 2), (1.0, width / 2)], color)

    def ground(self) -> None:
        y = self.to_px((0, 0))[1]
        self.draw.line([(0, y), (self.px, y)], fill=MUTED, width=max(2, int(0.02 * self.scale)))

    def wall(self, x: float, top: float = 3.0) -> None:
        self.bone((x, 0.0), (x, top), 0.03, MUTED)

    def bar(self, point: Point, half_width: float = 0.30) -> None:
        """Перекладина турника: короткий отрезок с кругом сечения там, где хват."""
        self.bone((point[0] - half_width, point[1]), (point[0] + half_width, point[1]), 0.035, MUTED)

    def chair(self, seat: Point, half_width: float = 0.20, back: int = 0) -> None:
        """Стул в профиль: сиденье, две ножки и, если нужно, спинка с одной стороны."""
        x0, x1 = seat[0] - half_width, seat[0] + half_width
        self.bone((x0, seat[1]), (x1, seat[1]), 0.04, MUTED)
        for x in (x0 + 0.03, x1 - 0.03):
            self.bone((x, seat[1]), (x, 0.0), 0.025, MUTED)
        if back:
            x = x1 - 0.03 if back > 0 else x0 + 0.03
            self.bone((x, seat[1]), (x, seat[1] + 0.42), 0.03, MUTED)

    def table(self, x0: float, x1: float, top: float) -> None:
        self.bone((x0, top), (x1, top), 0.05, MUTED)
        self.bone((x1 - 0.05, top), (x1 - 0.05, 0.0), 0.035, MUTED)

    def arrow(self, a: Point, b: Point, color=ACCENT) -> None:
        pa, pb = self.to_px(a), self.to_px(b)
        width = max(2, int(0.024 * self.scale))
        angle = math.atan2(pb[1] - pa[1], pb[0] - pa[0])
        head = 0.075 * self.scale
        neck = (pb[0] - math.cos(angle) * head * 0.7, pb[1] - math.sin(angle) * head * 0.7)
        self.draw.line([pa, neck], fill=color, width=width)
        tip = [pb]
        for side in (2.65, -2.65):
            tip.append((pb[0] + math.cos(angle + side) * head, pb[1] + math.sin(angle + side) * head))
        self.draw.polygon(tip, fill=color)

    def kettlebell(self, hand: Point, radius: float, hang: Point = (0.0, -1.0), color=INK) -> None:
        """Гиря под кистью. `hang` — куда она висит: вниз в покое, вдоль руки в свинге."""
        length = math.hypot(*hang) or 1.0
        hang = (hang[0] / length, hang[1] / length)
        body = add(hand, hang, radius * 1.45)
        self.disc(body, radius + 0.016, BG)
        self.ring(add(hand, hang, radius * 0.35), radius * 0.6, 0.026, color)
        self.disc(body, radius, color)

    def backpack(self, center: Point, angle_deg: float = 0.0, size: float = 0.16) -> None:
        """Рюкзак: корпус, ручка сверху и карман — иначе он читается как камень."""
        up = rot((0.0, 1.0), angle_deg)
        self.oval(center, size * 0.62 + 0.014, size + 0.014, angle_deg, BG)
        self.ring(add(center, up, size * 1.02), size * 0.22, 0.022, INK)
        self.oval(center, size * 0.62, size, angle_deg, INK)
        self.oval(add(center, up, -size * 0.38), size * 0.44, size * 0.36, angle_deg, PANTS)

    def mat(self, a: Point, b: Point) -> None:
        """Коврик под лежащим — у вида сверху это единственная подсказка, что человек на полу."""
        pa, pb = self.to_px(a), self.to_px(b)
        box = [min(pa[0], pb[0]), min(pa[1], pb[1]), max(pa[0], pb[0]), max(pa[1], pb[1])]
        self.draw.rounded_rectangle(box, radius=0.06 * self.scale, fill=SHADOW)

    def roll(self, center: Point, radius: float = 0.08) -> None:
        """Свёрнутое полотенце под лопатками."""
        self.disc(center, radius, MUTED)
        self.ring(center, radius * 0.55, 0.012, SHADOW)

    def label(self, text: str) -> None:
        font = None
        for path in FONT_CANDIDATES:
            try:
                font = ImageFont.truetype(path, int(self.px * 0.048))
                break
            except OSError:
                continue
        if font is None:
            return
        self.draw.text((int(self.px * 0.06), int(self.px * 0.05)), text, font=font, fill=INK)

    def finish(self) -> Image.Image:
        return self.image.resize((SIZE, SIZE), Image.LANCZOS)


# --- Части тела -------------------------------------------------------------
# Профили толщины: (доля длины сегмента, радиус). Худощавый человек, 190/73.

UPPER_ARM_R = [(0.0, 0.048), (0.4, 0.046), (1.0, 0.036)]
FOREARM_R = [(0.0, 0.036), (0.3, 0.038), (1.0, 0.026)]
THIGH_R = [(0.0, 0.074), (0.35, 0.068), (1.0, 0.048)]
SHIN_R = [(0.0, 0.047), (0.3, 0.052), (1.0, 0.030)]
FOOT_R = [(0.0, 0.038), (0.6, 0.032), (1.0, 0.022)]
SLEEVE_R = [(0.0, 0.057), (1.0, 0.053)]
HAND_R = 0.036

# Корпус в профиль: доля от таза к плечу, толщина спереди (грудь, живот) и сзади (ягодицы, спина).
TORSO_R = [
    (-0.16, 0.035, 0.060),
    (0.00, 0.080, 0.105),
    (0.25, 0.078, 0.078),
    (0.52, 0.088, 0.070),
    (0.78, 0.105, 0.086),
    (0.98, 0.078, 0.090),
    (1.10, 0.030, 0.050),
]
# Та же доля, до которой корпус — это штаны, а не футболка.
WAIST_S = 0.12


def hand_at(elbow: Point, wrist: Point) -> Point:
    return add(wrist, unit(elbow, wrist), 0.035)


def draw_arm(
    canvas: Canvas,
    shoulder: Point,
    wrist: Point,
    tone: Tone,
    bend: float = 1.0,
    elbow: Point | None = None,
    gap: float = 0.0,
    hand_scale: float = 1.0,
    bell: float | None = None,
    bell_hang: Point = (0.0, -1.0),
) -> Point:
    """Рука: плечо в рукаве футболки, голое предплечье, кулак. Возвращает кисть.

    Гиря рисуется поверх предплечья, а кулак — поверх её дужки: иначе светлая обводка
    руки стирает гирю, которая лежит на предплечье в стойке или в жиме.
    """
    if elbow is None:
        elbow = ik(shoulder, wrist, UPPER_ARM, FOREARM, bend)
    canvas.limb(elbow, wrist, FOREARM_R, tone.skin, gap)
    canvas.limb(shoulder, elbow, UPPER_ARM_R, tone.skin, gap)
    canvas.limb(shoulder, lerp_pt(shoulder, elbow, 0.5), SLEEVE_R, tone.shirt)
    hand = hand_at(elbow, wrist)
    if bell is not None:
        canvas.kettlebell(hand, bell * hand_scale, bell_hang, tone.bell)
    canvas.disc(hand, HAND_R * hand_scale, tone.skin)
    return hand


def foot_points(ankle: Point, knee: Point, style: str, toe: float) -> tuple[Point, Point] | None:
    """Пятка и носок. `toe` — куда по полу смотрит носок: +1 вправо, −1 влево."""
    shin = unit(knee, ankle)
    if style == "flat":
        return (ankle[0] - 0.05 * toe, ankle[1] + 0.035), (ankle[0] + 0.16 * toe, ankle[1] + 0.022)
    if style == "toes":
        # Пятка поднята, носок в полу.
        tip = (ankle[0] + 0.12 * toe, 0.022)
        return lerp_pt(tip, ankle, 1.35), tip
    if style == "flex":
        # Стопа под прямым углом к голени: пятка на полу, носок вверх (или в пол в планке).
        d = rot(shin, 90 * toe)
        return add(ankle, shin, -0.01), add(ankle, d, 0.15)
    if style == "point":
        # Носок вытянут: вис, лёжа на животе.
        d = rot(shin, 16 * toe)
        return add(ankle, d, -0.02), add(ankle, d, 0.15)
    return None


def draw_leg(
    canvas: Canvas,
    hip: Point,
    ankle: Point,
    tone: Tone,
    bend: float = 1.0,
    knee: Point | None = None,
    foot: str = "flat",
    toe: float = 1.0,
) -> Point:
    if knee is None:
        knee = ik(hip, ankle, THIGH, SHIN, bend)
    canvas.limb(knee, ankle, SHIN_R, tone.pants)
    canvas.limb(hip, knee, THIGH_R, tone.pants)
    points = foot_points(ankle, knee, foot, toe)
    if points is not None:
        canvas.limb(points[0], points[1], FOOT_R, tone.shoe)
    return knee


def draw_torso(
    canvas: Canvas,
    hip: Point,
    shoulder: Point,
    facing: float = 1.0,
    curve: float = 0.0,
    breath_in: float = 0.0,
) -> Point:
    """Корпус в профиль. Возвращает направление «вперёд» — туда смотрят грудь и лицо.

    `curve` > 0 — спина круглится (кошка), < 0 — прогиб (корова, супермен).
    """
    u = unit(hip, shoulder)
    length = math.dist(hip, shoulder)
    front_dir = (u[1] * facing, -u[0] * facing)
    front: list[Point] = []
    back: list[Point] = []
    s0, s1 = TORSO_R[0][0], TORSO_R[-1][0]
    steps = 24
    waist = 0
    for index in range(steps + 1):
        s = lerp(s0, s1, index / steps)
        if s <= WAIST_S:
            waist = index
        f, b = profile_at(TORSO_R, s)
        # Вдох расширяет грудь и нижние рёбра, таз и плечи остаются на месте.
        chest = math.sin(math.pi * min(1.0, max(0.0, (s - 0.30) / 0.65)))
        f *= 1 + breath_in * 0.12 * chest
        bump = math.sin(math.pi * min(1.0, max(0.0, s))) * curve
        c = add(add(hip, u, s * length), front_dir, -bump)
        front.append(add(c, front_dir, f))
        back.append(add(c, front_dir, -b))
    canvas.poly(front + back[::-1], SHIRT)
    canvas.poly(front[: waist + 1] + back[: waist + 1][::-1], PANTS)
    return front_dir


def draw_head(
    canvas: Canvas,
    base: Point,
    neck_dir: Point,
    head_dir: Point,
    facing: float,
    neck: float = NECK,
) -> Point:
    """Голова в профиль: затылок в волосах, челюсть, нос. По ним видно, куда смотрит лицо."""
    top = add(base, neck_dir, neck)
    front = (head_dir[1] * facing, -head_dir[0] * facing)
    center = add(add(top, head_dir, HEAD_R * 0.72), front, HEAD_R * 0.10)
    canvas.limb(base, add(top, head_dir, HEAD_R * 0.3), [(0.0, 0.045), (1.0, 0.040)], SKIN)

    def at(phi: float, dist: float) -> Point:
        a = math.radians(phi)
        return add(add(center, head_dir, math.cos(a) * dist), front, math.sin(a) * dist)

    canvas.disc(center, HEAD_R, SKIN)
    canvas.disc(at(128, HEAD_R * 0.38), HEAD_R * 0.70, SKIN)
    canvas.disc(at(92, HEAD_R * 0.98), HEAD_R * 0.17, SKIN)
    canvas.poly([at(62 - index * 11.25, HEAD_R * 1.06) for index in range(17)], HAIR)
    canvas.disc(at(-95, HEAD_R * 0.05), HEAD_R * 0.17, SKIN)
    return center


# --- Фигура в профиль --------------------------------------------------------


@dataclass
class Pose:
    """Опорные точки фигуры в профиль. Лицом вправо, если не сказано иначе.

    Ближние рука и нога — рабочие и яркие; дальние рисуются бледно и только тогда,
    когда видны: вторая нога в шаге, рука-опора на стуле, вторая гиря.
    """

    hip: Point
    shoulder: Point
    wrist: Point
    ankle: Point
    # Наклон головы и шеи относительно корпуса, градусы; минус — подбородок вперёд-вниз.
    head_lean: float = 0.0
    neck_lean: float | None = None
    # Абсолютный угол головы, когда она лежит на полу и не следует за корпусом.
    head_angle: float | None = None
    neck: float = NECK
    knee_bend: float = 1.0
    elbow_bend: float = 1.0
    # Явный локоть — для проекций, где рука уходит от камеры и укорачивается.
    elbow: Point | None = None
    knee: Point | None = None
    # Снаряд в ближней руке: радиус гири и куда она висит.
    bell: float | None = None
    bell_hang: Point = (0.0, -1.0)
    hand_scale: float = 1.0
    # Дальняя рука: опора на стул, вторая гиря.
    far_wrist: Point | None = None
    far_elbow_bend: float = 1.0
    far_elbow: Point | None = None
    far_bell: float | None = None
    # Дальняя нога: щиколотка, при необходимости колено.
    free_leg: Point | None = None
    free_knee: Point | None = None
    free_knee_bend: float | None = None
    free_foot: str = "flat"
    foot: str = "flat"
    # Куда смотрит носок: по умолчанию туда же, куда лицо.
    toe: float | None = None
    free_toe: float | None = None
    # −1 — лицом вверх (лёжа на спине головой вправо).
    facing: float = 1.0
    curve: float = 0.0
    breath: float = 0.0
    # Слой ближней руки: "front" — поверх всего, "behind" — за корпусом (продевается
    # под ним), "behind_head" — перед корпусом, но за головой (ладони на затылке),
    # "none" — рука рисуется отдельно, поверх снаряда (рюкзак в руках).
    arm_layer: str = "front"
    backpack: bool = False
    arrow: tuple[Point, Point] | None = None
    guide: tuple[Point, Point] | None = None


def head_frame(pose: Pose, front: Point) -> tuple[Point, Point, Point]:
    """Основание шеи и направления шеи и головы — нужны и фигуре, и тем, кто кладёт ладонь на лоб."""
    u = unit(pose.hip, pose.shoulder)
    base = add(add(pose.shoulder, u, 0.04), front, -0.012)
    if pose.head_angle is not None:
        head_dir = polar((0.0, 0.0), pose.head_angle, 1.0)
        neck_dir = rot(u, pose.neck_lean if pose.neck_lean is not None else 0.0)
    else:
        head_dir = rot(u, pose.head_lean)
        neck_dir = rot(u, pose.neck_lean if pose.neck_lean is not None else pose.head_lean * 0.6)
    return base, neck_dir, head_dir


def head_center(pose: Pose) -> Point:
    u = unit(pose.hip, pose.shoulder)
    front = (u[1] * pose.facing, -u[0] * pose.facing)
    base, neck_dir, head_dir = head_frame(pose, front)
    top = add(base, neck_dir, pose.neck)
    head_front = (head_dir[1] * pose.facing, -head_dir[0] * pose.facing)
    return add(add(top, head_dir, HEAD_R * 0.72), head_front, HEAD_R * 0.10)


def draw_figure(canvas: Canvas, pose: Pose) -> None:
    facing = pose.facing
    toe = pose.toe if pose.toe is not None else (1.0 if facing > 0 else -1.0)
    free_toe = pose.free_toe if pose.free_toe is not None else toe

    if pose.guide is not None:
        canvas.bone(pose.guide[0], pose.guide[1], 0.014, ACCENT)

    if pose.far_wrist is not None:
        far_elbow = pose.far_elbow or ik(pose.shoulder, pose.far_wrist, UPPER_ARM, FOREARM, pose.far_elbow_bend)
        draw_arm(canvas, pose.shoulder, pose.far_wrist, FAR, elbow=far_elbow, bell=pose.far_bell)

    if pose.free_leg is not None:
        draw_leg(
            canvas,
            pose.hip,
            pose.free_leg,
            FAR,
            pose.free_knee_bend if pose.free_knee_bend is not None else pose.knee_bend,
            pose.free_knee,
            pose.free_foot,
            free_toe,
        )

    draw_leg(canvas, pose.hip, pose.ankle, NEAR, pose.knee_bend, pose.knee, pose.foot, toe)

    elbow = pose.elbow or ik(pose.shoulder, pose.wrist, UPPER_ARM, FOREARM, pose.elbow_bend)

    def near_arm(gap: float) -> None:
        draw_arm(
            canvas,
            pose.shoulder,
            pose.wrist,
            NEAR,
            elbow=elbow,
            gap=gap,
            hand_scale=pose.hand_scale,
            bell=pose.bell,
            bell_hang=pose.bell_hang,
        )

    if pose.arm_layer == "behind":
        near_arm(0.0)

    front = draw_torso(canvas, pose.hip, pose.shoulder, facing, pose.curve, pose.breath)
    if pose.arm_layer == "behind_head":
        near_arm(0.014)
    base, neck_dir, head_dir = head_frame(pose, front)
    draw_head(canvas, base, neck_dir, head_dir, facing, pose.neck)

    if pose.backpack:
        u = unit(pose.hip, pose.shoulder)
        pack = add(add(pose.shoulder, u, -0.20), front, -0.17)
        canvas.backpack(pack, angle_of(pose.hip, pose.shoulder) - 90)
        # Лямка через плечо: без неё рюкзак читается как горб.
        canvas.bone(add(pack, u, 0.12), add(add(pose.shoulder, front, 0.07), u, -0.02), 0.028, INK)

    if pose.arm_layer == "front":
        near_arm(0.014)

    if pose.arrow is not None:
        canvas.arrow(pose.arrow[0], pose.arrow[1])


Draw = Callable[[Canvas, float], None]


def figure(pose_fn: Callable[[float], Pose]) -> Draw:
    """Обёртка для упражнений, которые целиком описываются позой профильной фигуры."""

    def draw(canvas: Canvas, t: float) -> None:
        draw_figure(canvas, pose_fn(t))

    return draw


# --- Фигура анфас и со спины ------------------------------------------------
# Для шеи (наклоны вбок, ротация), halo, скольжения по стене, «мухи» и лёжа
# на животе: в профиль там не видно ни рук, ни того, куда уходит голова.

# Половина ширины корпуса на высоте доли от таза до основания шеи.
FRONT_TORSO = [
    (-0.12, 0.060),
    (0.00, 0.160),
    (0.14, 0.160),
    (0.38, 0.135),
    (0.66, 0.155),
    (0.84, 0.185),
    (0.93, 0.215),
    (0.98, 0.170),
    (1.00, 0.060),
]
SHOULDER_W = 0.19
HIP_W = 0.09


@dataclass
class Front:
    """Фигура лицом к камере (или спиной, `back=True`), корпус по оси таз → шея.

    Ось может лежать под любым углом: боковая планка и лёжа на боку — та же фигура,
    повёрнутая набок.
    """

    pelvis: Point
    neck: Point
    # Кисти: первая — со стороны −side (слева у стоящего), вторая — со стороны +side.
    # None — рука опущена вдоль тела.
    hands: tuple[Point | None, Point | None] = (None, None)
    # Куда смотрят локти: вектор предпочтения для каждой руки.
    elbows: tuple[Point, Point] | None = None
    # Явные локти — для проекций, где предплечье уходит в камеру и укорачивается.
    elbow_at: tuple[Point | None, Point | None] = (None, None)
    feet: tuple[Point, Point] | None = None
    tilt: float = 0.0
    turn: float = 0.0
    nod: float = 0.0
    back: bool = False
    # Голова ближе к камере, чем плечи (наклон вперёд): рисуется поверх груди ниже шеи.
    head_drop: float = 0.0
    # Руки, которые проходят за головой, рисуются до неё.
    behind_head: tuple[bool, bool] = (False, False)
    hand_scale: tuple[float, float] = (1.0, 1.0)
    bells: tuple[float | None, float | None] = (None, None)
    # Тень под руками при виде сверху: насколько они оторваны от пола.
    lift: float = 0.0
    # Плечи к ушам: доля высоты корпуса, на которую плечи уходят вверх, голова стоит.
    shrug: float = 0.0


def front_axes(pose: Front) -> tuple[Point, Point, float]:
    u = unit(pose.pelvis, pose.neck)
    side = (u[1], -u[0])
    return u, side, math.dist(pose.pelvis, pose.neck)


def front_shoulders(pose: Front) -> tuple[Point, Point]:
    u, side, height = front_axes(pose)
    base = add(pose.pelvis, u, height * (0.90 + pose.shrug))
    return add(base, side, -SHOULDER_W), add(base, side, SHOULDER_W)


def front_head_center(pose: Front) -> Point:
    u, _, _ = front_axes(pose)
    up = rot(u, pose.tilt)
    return add(pose.neck, up, NECK + HEAD_R * 0.8 - pose.head_drop)


def draw_front_head(canvas: Canvas, pose: Front) -> Point:
    """Голова анфас: уши, волосы шапкой, глаза и нос. Со спины — один затылок."""
    u, _, _ = front_axes(pose)
    up = rot(u, pose.tilt)
    side = (up[1], -up[0])
    center = front_head_center(pose)
    if pose.head_drop < 0.05:
        canvas.limb(pose.neck, center, [(0.0, 0.046), (1.0, 0.042)], SKIN)
    angle = angle_of((0.0, 0.0), up) - 90
    for sign in (-1, 1):
        canvas.disc(add(center, side, sign * HEAD_R * 0.88), 0.024, SKIN)
    if pose.back:
        canvas.oval(center, HEAD_R * 0.9, HEAD_R * 1.08, angle, HAIR)
        return center
    canvas.oval(center, HEAD_R * 0.86, HEAD_R * 1.05, angle, SKIN)
    # Лицо: при ротации черты уезжают вбок, при кивке — вниз, а волос видно больше.
    shift = pose.turn * HEAD_R * 0.45
    drop = pose.nod * HEAD_R * 0.45
    hairline = HEAD_R * (0.28 - pose.nod * 0.35)
    hair = [
        add(add(center, side, math.sin(a) * HEAD_R * 0.92), up, math.cos(a) * HEAD_R * 1.10)
        for a in (math.radians(lerp(-95, 95, index / 14)) for index in range(15))
    ]
    hair += [add(add(center, side, HEAD_R * 0.9), up, hairline), add(add(center, side, -HEAD_R * 0.9), up, hairline)]
    canvas.poly(hair, HAIR)
    for sign in (-1, 1):
        squeeze = 1.0 - 0.35 * max(0.0, sign * pose.turn)
        eye = add(add(center, side, shift + sign * HEAD_R * 0.36 * squeeze), up, -drop + HEAD_R * 0.02)
        canvas.disc(eye, 0.013, INK)
    nose_top = add(add(center, side, shift * 1.2), up, -drop - HEAD_R * 0.10)
    canvas.bone(nose_top, add(nose_top, up, -HEAD_R * 0.22), 0.022, (196, 140, 106))
    return center


def draw_front(canvas: Canvas, pose: Front, extra: Callable[[], None] | None = None) -> None:
    """Ноги, корпус, руки, голова. `extra` рисуется поверх головы, но под руками (гиря в halo)."""
    u, side, height = front_axes(pose)

    if pose.feet is not None:
        for sign, foot in zip((-1, 1), pose.feet):
            hip = add(pose.pelvis, side, sign * HIP_W)
            knee = ik_toward(hip, foot, THIGH, SHIN, (side[0] * sign, side[1] * sign))
            canvas.limb(knee, foot, SHIN_R, PANTS)
            canvas.limb(hip, knee, THIGH_R, PANTS)
            canvas.disc(add(foot, unit(knee, foot), 0.03), 0.045, INK)

    shoulders = front_shoulders(pose)
    elbows_pref = pose.elbows or (add((-side[0], -side[1]), u, -0.6), add(side, u, -0.6))

    def arm(index: int, gap: float) -> None:
        shoulder = shoulders[index]
        hand = pose.hands[index]
        if hand is None:
            hand = add(add(shoulder, u, -ARM * 0.96), side, (index * 2 - 1) * 0.04)
        elbow = pose.elbow_at[index] or ik_toward(shoulder, hand, UPPER_ARM, FOREARM, elbows_pref[index])
        if pose.lift:
            off = (pose.lift * 0.7, -pose.lift)
            canvas.limb(add(shoulder, off), add(elbow, off), UPPER_ARM_R, SHADOW)
            canvas.limb(add(elbow, off), add(hand, off), FOREARM_R, SHADOW)
            canvas.disc(add(hand_at(elbow, hand), off), HAND_R, SHADOW)
        draw_arm(
            canvas,
            shoulder,
            hand,
            NEAR,
            elbow=elbow,
            gap=gap,
            hand_scale=pose.hand_scale[index],
            bell=pose.bells[index],
        )

    for index in (0, 1):
        if pose.behind_head[index]:
            arm(index, 0.0)

    right: list[Point] = []
    left: list[Point] = []
    for s, half in FRONT_TORSO:
        c = add(pose.pelvis, u, s * height)
        right.append(add(c, side, half))
        left.append(add(c, side, -half))
    canvas.poly(right + left[::-1], SHIRT)
    canvas.poly(right[:3] + left[:3][::-1], PANTS)

    for index in (0, 1):
        if not pose.behind_head[index] and pose.head_drop > 0:
            arm(index, 0.014)
    draw_front_head(canvas, pose)
    if extra is not None:
        extra()
    for index in (0, 1):
        if not pose.behind_head[index] and pose.head_drop <= 0:
            arm(index, 0.014)


# --- Шея и голова крупным планом --------------------------------------------
# Корпус тот же, камера ближе: голова размером с ладонь, видно, куда она едет.

BUST_HIP = (0.0, -TORSO)
BUST_SHOULDER = (0.0, 0.0)


def bust(**kwargs) -> Pose:
    """Профиль по пояс: руки опущены, если не сказано иначе."""
    kwargs.setdefault("wrist", (0.02, -ARM * 0.97))
    kwargs.setdefault("ankle", (0.0, -TORSO - LEG))
    return Pose(hip=BUST_HIP, shoulder=BUST_SHOULDER, **kwargs)


def chin_tuck(canvas: Canvas, t: float) -> None:
    """NK1. Голова уезжает назад над плечом, подбородок скользит к горлу, взгляд прямо.

    Ход в жизни — пара сантиметров, на схеме он преувеличен, иначе его не видно.
    """
    k = rep(t, 0.28, 0.30, 0.28)
    pose = bust(neck_lean=lerp(-38.0, 8.0, k), head_lean=lerp(0.0, -6.0, k), neck=0.10, elbow_bend=-1.0)
    canvas.bone((0.0, -0.10), (0.0, 0.54), 0.012, ACCENT)
    draw_figure(canvas, pose)
    head = head_center(pose)
    if 0.12 < t < 0.75:
        canvas.arrow((head[0] + 0.32, head[1] + 0.02), (head[0] + 0.17, head[1] + 0.02))


def neck_isometric(direction: int) -> Draw:
    """NK2/NK3. Ладонь на лбу или на затылке, голова давит навстречу. Движения нет — только усилие."""

    def draw(canvas: Canvas, t: float) -> None:
        e = effort(t)
        lean = direction * (-1.5 * e + tremor(t) * e * 0.8)
        pose = bust(head_lean=lean, neck_lean=lean * 0.5, elbow_bend=-1.0)
        head = head_center(pose)
        if direction > 0:
            pose.wrist = (head[0] + HEAD_R * 1.05, head[1] + 0.035)
        else:
            # Ладони на затылке: предплечье уходит за голову, спереди виден только локоть.
            pose.wrist = (head[0] - HEAD_R * 1.0, head[1] - 0.01)
            pose.arm_layer = "behind_head"
        draw_figure(canvas, pose)
        tail = 0.06 + 0.10 * e
        y = head[1] + HEAD_R + 0.08
        canvas.arrow((head[0] - direction * tail * 0.5, y), (head[0] + direction * tail * 0.5, y))

    return draw


def neck_press_side(canvas: Canvas, t: float) -> None:
    """NK4. Ладонь на виске, голова давит вбок. Плечо остаётся внизу."""
    e = effort(t)
    tilt = -(2.0 * e + tremor(t) * e)
    pose = Front(pelvis=(0.0, -0.56), neck=(0.0, 0.04), tilt=tilt)
    center = front_head_center(pose)
    pose.hands = (None, (center[0] + HEAD_R * 1.0, center[1] - 0.005))
    pose.elbows = ((-1.0, -0.6), (1.0, -0.6))
    draw_front(canvas, pose)
    tail = 0.06 + 0.09 * e
    y = center[1] + HEAD_R + 0.08
    canvas.arrow((center[0] - tail * 0.5, y), (center[0] + tail * 0.5, y))
    canvas.arrow((-0.30, 0.22), (-0.30, 0.08))


def neck_press_rotation(canvas: Canvas, t: float) -> None:
    """NK5. Ладонь на скуле, попытка повернуть голову против сопротивления.

    Голова остаётся на месте — двигать в кадре нечего, кроме самого усилия. Поэтому
    заметно растёт стрелка, а голова только подрагивает: статичная гифка ещё и ломается
    у Telegram, который отдаёт такую обратно документом вместо анимации.
    """
    e = effort(t)
    pose = Front(pelvis=(0.0, -0.56), neck=(0.0, 0.04), turn=0.12 * e + tremor(t) * 0.05 * e)
    center = front_head_center(pose)
    pose.hands = (None, (center[0] + HEAD_R * 0.92, center[1] - 0.03))
    pose.elbows = ((-1.0, -0.6), (1.0, -0.4))
    draw_front(canvas, pose)
    tail = 0.06 + 0.09 * e
    y = center[1] + HEAD_R + 0.08
    canvas.arrow((center[0] - tail * 0.5, y), (center[0] + tail * 0.5, y))


def neck_stretch(turn: float, nod: float) -> Draw:
    """NK6/NK7. Рука сверху добавляет наклон, вторая держит сиденье — плечо не едет к уху."""

    def draw(canvas: Canvas, t: float) -> None:
        k = settle(t)
        tilt = lerp(0.0, 28.0 if nod == 0 else 24.0, k)
        pose = Front(pelvis=(0.0, -0.56), neck=(0.0, 0.04), tilt=tilt, turn=turn * k, nod=nod * k)
        center = front_head_center(pose)
        up = rot((0.0, 1.0), tilt)
        side = (up[1], -up[0])
        hand = add(add(center, side, HEAD_R * 0.55), up, HEAD_R * lerp(1.05, 0.85, abs(turn)))
        pose.hands = (hand, (0.26, -0.58))
        pose.elbows = ((-0.5, 1.0), (1.0, -0.2))
        pose.behind_head = (False, False)
        draw_front(canvas, pose)
        canvas.arrow((0.34, 0.20), (0.34, 0.04))

    return draw


def supine_head_lift(t: float) -> Pose:
    """NK8. Сначала подбородок назад, потом голова отрывается на пару сантиметров."""
    tuck = rep(t, 0.16, 0.62, 0.14)
    up = rep(t, 0.16, 0.42, 0.14, lag=0.10)
    return Pose(
        hip=(-0.26, 0.11),
        shoulder=(0.26, 0.11),
        wrist=(-0.24, 0.04),
        elbow=(0.00, 0.05),
        ankle=(-0.70, 0.0),
        knee_bend=-1.0,
        toe=-1.0,
        facing=-1.0,
        head_angle=lerp(0.0, 14.0, tuck) + 18.0 * up,
        neck_lean=24.0 * up,
        guide=((-0.90, 0.015), (0.60, 0.015)),
        arrow=((0.68, 0.16), (0.68, 0.32)) if up > 0.2 else None,
    )


def prone_head_lift(t: float) -> Pose:
    """NK9. Лоб на кулаках, голова и кулаки поднимаются вместе, взгляд остаётся в пол."""
    k = rep(t, 0.22, 0.44, 0.22)
    rise = 0.06 * k
    shoulder = (0.26, 0.11 + rise * 0.3)
    return Pose(
        hip=(-0.28, 0.10),
        shoulder=shoulder,
        wrist=(0.52, 0.07 + rise),
        elbow=(0.36, 0.05),
        ankle=(-1.10, 0.06),
        foot="point",
        toe=-1.0,
        head_lean=-12.0,
        neck_lean=14.0 * k,
        arrow=((0.80, 0.18 + rise), (0.80, 0.32 + rise)) if k > 0.3 else None,
    )


def breathing_90_90(canvas: Canvas, t: float) -> None:
    """NK10. Голени на стуле, поясница прижата, дышат нижние рёбра и бока."""
    # Вдох на 4 счёта, выдох на 6: вдох короче выдоха.
    phase = t % 1.0
    inhale = min_jerk(phase / 0.4) if phase < 0.4 else 1.0 - min_jerk((phase - 0.4) / 0.6)
    canvas.chair((0.40, 0.44), half_width=0.26, back=1)
    draw_figure(
        canvas,
        Pose(
            hip=(0.0, 0.11),
            shoulder=(-0.52, 0.11),
            wrist=(-0.30, 0.04),
            elbow=(-0.42, 0.05),
            ankle=(0.40, 0.52),
            knee=(0.02, 0.50),
            foot="flex",
            toe=-1.0,
            facing=1.0,
            head_angle=180.0,
            breath=inhale * 2.6 - 0.4,
            guide=((-0.60, 0.012), (0.08, 0.012)),
        ),
    )
    y = 0.30 + inhale * 0.05
    canvas.arrow((-0.26, y), (-0.26, y + 0.08 + inhale * 0.06))


# --- Упражнения в профиль ----------------------------------------------------
# Каждое: функция t ∈ [0,1] → Pose либо своя отрисовка.


def swing(t: float) -> Pose:
    """PC3. Удар тазом: гиря проводится между ног и отстаёт от таза, руки прямые."""
    k = pendulum(t)
    kb = pendulum(t, lag=0.05)
    hip = (lerp(0.0, -0.24, k), lerp(0.83, 0.68, k))
    shoulder = polar(hip, lerp(88.0, 40.0, k), TORSO)
    arm = lerp(-4.0, -130.0, kb)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, arm),
        ankle=(0.02, 0.0),
        bell=0.075,
        bell_hang=polar((0.0, 0.0), arm, 1.0),
        head_lean=lerp(0.0, 20.0, k),
        arrow=((hip[0] - 0.36, hip[1]), (hip[0] - 0.16, hip[1])) if 0.35 < (t - 0.5) % 1.0 < 0.65 else None,
    )


def swing_one_hand(t: float) -> Pose:
    """PC4. То же движение; свободная рука идёт вдоль тела для баланса."""
    pose = swing(t)
    kb = pendulum(t, lag=0.09)
    pose.far_wrist = straight_arm(pose.shoulder, lerp(-60.0, -118.0, kb), 0.95)
    pose.far_elbow_bend = -1.0
    return pose


def squat(t: float) -> Pose:
    """LG5. Таз вниз и назад, пятки на полу, спина прямая, руки вперёд для баланса."""
    k = lower(t)
    ka = lower(t, 0.04)
    hip = (lerp(0.0, -0.22, k), lerp(0.83, 0.44, k))
    shoulder = polar(hip, lerp(88.0, 56.0, k), TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, lerp(-86.0, -2.0, ka), 0.96),
        ankle=(0.02, 0.0),
        head_lean=lerp(0.0, 26.0, k),
        breath=breath(t) * 0.5,
    )


def pushup(t: float) -> Pose:
    """PR3. Тело одной линией от пяток до головы, локти уходят назад под 45°."""
    k = lower(t)
    toes = (-0.78, 0.08)
    angle = lerp(22.5, 6.0, k)
    shoulder = polar(toes, angle, BODY)
    return Pose(
        hip=polar(toes, angle, LEG),
        shoulder=shoulder,
        wrist=(0.54, 0.05),
        ankle=toes,
        foot="flex",
        elbow_bend=-1.0,
        head_lean=-6.0,
        breath=breath(t) * 0.3,
        arrow=((0.20, shoulder[1] + 0.40), (0.20, shoulder[1] + 0.18)) if 0.12 < t < 0.5 else None,
    )


def bent_row(canvas: Canvas, t: float) -> None:
    """RW1. Колено и ладонь на стуле, спина параллельна полу, локоть идёт вдоль тела."""
    k = lift(t)
    canvas.chair((0.10, 0.44), half_width=0.30)
    hip = (-0.14, 0.82)
    shoulder = polar(hip, 9.0 + 2.0 * k, TORSO)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(lerp(shoulder[0] - 0.02, 0.10, k), lerp(shoulder[1] - 0.56, 0.78, k)),
            ankle=(-0.22, 0.0),
            bell=0.075,
            elbow_bend=-1.0,
            head_lean=-28.0,
            far_wrist=(0.36, 0.49),
            far_elbow_bend=-1.0,
            free_leg=(-0.52, 0.52),
            free_knee=(-0.12, 0.50),
            free_foot="point",
            free_toe=-1.0,
            breath=breath(t) * 0.4,
        ),
    )


def gorilla_row(t: float) -> Pose:
    """RW2. Глубокий наклон, две гири на полу, тяга поочерёдно — корпус не проворачивается."""
    first = t < 0.5
    k = lift((t * 2.0) % 1.0)
    hip = (-0.18, 0.66)
    shoulder = polar(hip, 18.0, TORSO)
    floor = (shoulder[0] + 0.02, 0.25)
    pulled = (lerp(floor[0], 0.10, k), lerp(floor[1], 0.60, k))
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=pulled if first else floor,
        far_wrist=floor if first else pulled,
        far_elbow_bend=-1.0,
        far_bell=0.075,
        ankle=(-0.02, 0.0),
        free_leg=(-0.10, 0.0),
        bell=0.075,
        elbow_bend=-1.0,
        head_lean=-22.0,
    )


def backpack_row(canvas: Canvas, t: float) -> None:
    """RW8. Рюкзак за лямки, наклон с прямой спиной, тяга к животу."""
    k = lift(t)
    hip = (-0.16, 0.74)
    shoulder = polar(hip, 28.0, TORSO)
    wrist = (lerp(shoulder[0] + 0.02, 0.06, k), lerp(shoulder[1] - 0.56, 0.72, k))
    elbow = ik(shoulder, wrist, UPPER_ARM, FOREARM, -1.0)
    draw_figure(
        canvas,
        Pose(hip=hip, shoulder=shoulder, wrist=wrist, ankle=(-0.04, 0.0), head_lean=-18.0, arm_layer="none"),
    )
    hand = hand_at(elbow, wrist)
    canvas.backpack((hand[0] + 0.02, hand[1] - 0.15))
    draw_arm(canvas, shoulder, wrist, NEAR, elbow=elbow, gap=0.014)


def prone_row(t: float) -> Pose:
    """RW5. Лёжа на животе: локти тянут гири от пола к рёбрам, лоб остаётся у пола."""
    k = lift(t)
    shoulder = (0.26, 0.11)
    elbow = polar(shoulder, lerp(0.0, 125.0, k), UPPER_ARM)
    wrist = polar(elbow, lerp(0.0, -75.0, k), FOREARM * lerp(0.98, 0.6, k))
    return Pose(
        hip=(-0.28, 0.10),
        shoulder=shoulder,
        wrist=wrist,
        elbow=elbow,
        ankle=(-1.10, 0.06),
        foot="point",
        toe=-1.0,
        bell=0.07,
        head_lean=-12.0,
    )


def with_bar(pose_fn: Callable[[float], Pose]) -> Draw:
    """Турник рисуется отдельно: без перекладины вис читается как парение."""

    def draw(canvas: Canvas, t: float) -> None:
        canvas.bar((0.06, 2.26), half_width=0.44)
        draw_figure(canvas, pose_fn(t))

    return draw


def hanging(shoulder: Point, wrist: Point, **kwargs) -> Pose:
    hip = (shoulder[0] - 0.04, shoulder[1] - TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(hip[0] - 0.02, hip[1] - LEG * 0.97),
        foot="point",
        elbow_bend=-1.0,
        **kwargs,
    )


def pullup(t: float) -> Pose:
    """RW6. Локти к рёбрам, тело вертикально, внизу вис полный."""
    k = lift(t)
    return hanging((0.0, lerp(1.50, 1.90, k)), (0.12, 2.24), head_lean=6.0 * k, breath=0.5 * k)


def bar_hang(t: float) -> Pose:
    """SC8. Свободный вис — плечи у ушей; потом лопатки вниз, и тело чуть поднимается."""
    k = rep(t, 0.24, 0.36, 0.26)
    shoulder = (0.0, lerp(1.48, 1.57, k))
    pose = hanging(shoulder, (0.10, 2.24), neck=lerp(0.025, NECK, k))
    if k > 0.3:
        pose.arrow = ((0.30, shoulder[1] + 0.20), (0.30, shoulder[1] + 0.02))
    return pose


def table_row(canvas: Canvas, t: float) -> None:
    """RW7. Под столом: тело прямой линией от пяток, грудь идёт к краю стола."""
    k = lift(t)
    canvas.table(0.34, 1.30, 0.80)
    heels = (-0.84, 0.06)
    angle = lerp(7.5, 24.0, k)
    shoulder = polar(heels, angle, BODY)
    draw_figure(
        canvas,
        Pose(
            hip=polar(heels, angle, LEG),
            shoulder=shoulder,
            wrist=(0.40, 0.80),
            ankle=heels,
            foot="flex",
            facing=-1.0,
            elbow_bend=1.0,
            guide=(heels, polar(heels, angle, BODY + 0.24)),
        ),
    )


def romanian_deadlift(t: float) -> Pose:
    """PC1. Таз назад, колени мягкие, гири скользят вдоль ног, спина прямая."""
    k = lower(t)
    hip = (lerp(0.0, -0.20, k), lerp(0.83, 0.76, k))
    lean = lerp(88.0, 26.0, k)
    shoulder = polar(hip, lean, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0 + 4.0 * k),
        ankle=(0.02, 0.0),
        bell=0.075,
        head_lean=lerp(0.0, 14.0, k),
        guide=(hip, shoulder) if k > 0.4 else None,
    )


def single_leg_deadlift(t: float) -> Pose:
    """PC2. Свободная нога уходит назад в линию с корпусом, свободная рука — для баланса."""
    k = lower(t)
    hip = (lerp(0.0, -0.12, k), lerp(0.82, 0.74, k))
    lean = lerp(88.0, 16.0, k)
    shoulder = polar(hip, lean, TORSO)
    back_leg = polar(hip, lean - 180.0 + 4.0 * (1 - k), LEG * 0.97)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0),
        ankle=(0.02, 0.0),
        bell=0.07,
        free_leg=back_leg if k > 0.02 else (hip[0] - 0.02, 0.0),
        free_foot="flex" if k > 0.3 else "flat",
        free_toe=1.0,
        far_wrist=straight_arm(shoulder, lerp(-90.0, -60.0, k), 0.95),
        head_lean=lerp(0.0, 10.0, k),
        guide=(shoulder, back_leg) if k > 0.6 else None,
    )


def good_morning(t: float) -> Pose:
    """PC5. Наклон с прямой спиной, гиря прижата к груди — база тазового шарнира."""
    k = lower(t)
    hip = (lerp(0.0, -0.18, k), lerp(0.83, 0.77, k))
    lean = lerp(88.0, 30.0, k)
    shoulder = polar(hip, lean, TORSO)
    chest = polar(shoulder, lean - 150.0, 0.16)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=chest,
        ankle=(0.02, 0.0),
        bell=0.075,
        bell_hang=polar((0.0, 0.0), lean - 180.0, 1.0),
        elbow_bend=-1.0,
        head_lean=lerp(0.0, 12.0, k),
    )


def backpack_deadlift(canvas: Canvas, t: float) -> None:
    """PC9. Рюкзак между стоп: таз назад, колени сгибаются, встаёшь ногами и тазом разом."""
    k = rep(t, 0.30, 0.18, 0.40)
    hip = (lerp(-0.04, -0.22, k), lerp(0.83, 0.52, k))
    shoulder = polar(hip, lerp(88.0, 46.0, k), TORSO)
    wrist = straight_arm(shoulder, -86.0)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=wrist,
            ankle=(0.06, 0.0),
            head_lean=lerp(0.0, 18.0, k),
            guide=(hip, shoulder) if k > 0.5 else None,
            arm_layer="none",
        ),
    )
    elbow = ik(shoulder, wrist, UPPER_ARM, FOREARM, 1.0)
    hand = hand_at(elbow, wrist)
    canvas.backpack((hand[0] + 0.02, max(0.17, hand[1] - 0.15)))
    draw_arm(canvas, shoulder, wrist, NEAR, elbow=elbow, gap=0.014)


def overhead_press(t: float) -> Pose:
    """PR1. Корпус как доска, гиря из стойки на груди идёт вертикально вверх."""
    k = lift(t)
    hip = (0.0, 0.83)
    shoulder = polar(hip, 90.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(shoulder[0] + lerp(0.10, 0.03, k), lerp(shoulder[1] + 0.04, shoulder[1] + 0.56, k)),
        ankle=(0.02, 0.0),
        bell=0.075,
        bell_hang=(-0.7, -0.7),
        elbow_bend=-1.0,
        head_lean=-2.0 * k,
        breath=breath(t) * 0.4,
        guide=(hip, (hip[0], hip[1] + TORSO + 0.70)),
    )


def supine(**kwargs) -> Pose:
    """Лёжа на спине головой вправо, колени согнуты, стопы на полу."""
    kwargs.setdefault("hip", (-0.24, 0.11))
    kwargs.setdefault("shoulder", (0.28, 0.11))
    kwargs.setdefault("ankle", (-0.68, 0.0))
    kwargs.setdefault("head_angle", 0.0)
    return Pose(knee_bend=-1.0, toe=-1.0, facing=-1.0, **kwargs)


def floor_press(t: float) -> Pose:
    """PR4. Локоть от пола, гиря вверх; пол сам ограничивает амплитуду."""
    k = lift(t)
    return supine(
        wrist=(0.32, lerp(0.38, 0.68, k)),
        elbow_bend=1.0,
        bell=0.07,
        bell_hang=(0.5, -0.8),
    )


def pullover(t: float) -> Pose:
    """SC9. Прямые руки с гирей уходят за голову, поясница прижата к полу."""
    k = lower(t)
    arm = lerp(90.0, 16.0, k)
    return supine(
        wrist=straight_arm((0.28, 0.11), arm),
        bell=0.07,
        bell_hang=polar((0.0, 0.0), arm, 1.0),
        guide=((-0.40, 0.012), (0.34, 0.012)),
    )


def y_raise(t: float) -> Pose:
    """PR6. Наклон 45°, прямые руки идут вперёд-вверх буквой Y до уровня головы."""
    k = lift(t)
    hip = (-0.10, 0.80)
    shoulder = polar(hip, 44.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, lerp(-90.0, 30.0, k)),
        ankle=(-0.08, 0.0),
        bell=0.055,
        head_lean=-22.0,
    )


def suitcase_steps(t: float) -> tuple[Pose, float]:
    """Шаг на месте: опора 60% цикла, стопа едет назад по полу; перенос — колено вперёд."""
    t = (t * 2.0) % 1.0

    def foot(phase: float) -> tuple[Point, str]:
        x = phase % 1.0
        if x < 0.6:
            return (lerp(0.20, -0.22, x / 0.6), 0.0), "flat"
        y = (x - 0.6) / 0.4
        return (lerp(-0.22, 0.20, min_jerk(y)), math.sin(math.pi * y) * 0.10), "point" if y < 0.45 else "flat"

    near, near_style = foot(t)
    far, far_style = foot(t + 0.5)
    hip = (0.0, 0.83 + 0.014 * math.cos(4 * math.pi * t))
    shoulder = polar(hip, 88.0, TORSO)
    pose = Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0, 0.93),
        ankle=near,
        foot=near_style,
        free_leg=far,
        free_foot=far_style,
        elbow_bend=-1.0,
    )
    return pose, math.sin(2 * math.pi * t)


def walk(t: float) -> Pose:
    """MB9. Спокойный шаг, руки качаются навстречу ногам."""
    pose, swing_ = suitcase_steps(t)
    pose.wrist = straight_arm(pose.shoulder, -90.0 - swing_ * 20.0, 0.93)
    pose.far_wrist = straight_arm(pose.shoulder, -90.0 + swing_ * 20.0, 0.93)
    pose.far_elbow_bend = -1.0
    return pose


def suitcase_carry(t: float) -> Pose:
    """CR3. Гиря в одной руке, корпус строго вертикально — плечо не проваливается."""
    pose, swing_ = suitcase_steps(t)
    pose.bell = 0.08
    pose.far_wrist = straight_arm(pose.shoulder, -90.0 + swing_ * 16.0, 0.93)
    pose.far_elbow_bend = -1.0
    pose.guide = (pose.shoulder, (pose.shoulder[0], 0.0))
    return pose


def farmer_carry(t: float) -> Pose:
    """CR4. Две гири, плечи опущены и раскрыты, руки не качаются."""
    pose, _ = suitcase_steps(t)
    pose.bell = 0.08
    return pose


def rack_carry(t: float) -> Pose:
    """CR7. Гиря на груди, локоть под ней, корпус вертикально, шаг ровный."""
    pose, swing_ = suitcase_steps(t)
    pose.wrist = (pose.shoulder[0] + 0.10, pose.shoulder[1] + 0.02)
    pose.bell = 0.075
    pose.bell_hang = (-0.7, -0.7)
    pose.far_wrist = straight_arm(pose.shoulder, -90.0 + swing_ * 18.0, 0.93)
    pose.far_elbow_bend = -1.0
    return pose


def backpack_carry(t: float) -> Pose:
    """CR8. Рюкзак сидит высоко на спине, корпус не заваливается вперёд."""
    pose = walk(t)
    pose.backpack = True
    pose.guide = (pose.shoulder, (pose.shoulder[0], 0.0))
    return pose


def plank(t: float) -> Pose:
    """CR1. На предплечьях: локти под плечами, тело прямой линией, дыхание ровное.

    Таз понемногу проседает — это и есть главная ошибка — и возвращается в линию.
    """
    toes = (-1.02, 0.08)
    shoulder = (0.32, 0.36)
    line_hip = lerp_pt(toes, shoulder, LEG / BODY)
    sag = rep(t, 0.40, 0.14, 0.18)
    hip = (line_hip[0], line_hip[1] - sag * 0.06)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(0.60, 0.06),
        elbow=(0.32, 0.06),
        ankle=toes,
        foot="flex",
        head_lean=-4.0,
        breath=breath(t * 2.0) * 0.5,
        guide=(toes, shoulder),
        arrow=((hip[0], hip[1] - 0.26), (hip[0], hip[1] - 0.08)) if sag > 0.5 else None,
    )


def back_lunge(t: float) -> Pose:
    """LG2. Шаг назад, потом вниз: переднее бедро до параллели, колено над стопой."""
    step = rep(t, 0.24, 0.40, 0.24)
    down = rep(t, 0.26, 0.20, 0.22, lag=0.12)
    lift_foot = math.sin(math.pi * min(1.0, max(0.0, step if step < 1 else 0))) * 0.06
    hip = (lerp(0.0, -0.06, step), lerp(0.83, 0.50, down))
    shoulder = polar(hip, 86.0, TORSO)
    back_x = lerp(-0.02, -0.66, step)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=polar(shoulder, -72.0, 0.30),
        elbow_bend=-1.0,
        ankle=(0.14, 0.0),
        free_leg=(back_x, lift_foot if down < 0.05 else 0.02),
        free_foot="toes" if step > 0.5 else "flat",
        head_lean=-2.0,
    )


def bulgarian_squat(canvas: Canvas, t: float) -> None:
    """LG4. Задняя стопа на стуле, работает передняя нога, корпус чуть вперёд."""
    k = lower(t)
    canvas.chair((-0.62, 0.44), half_width=0.20, back=-1)
    hip = (lerp(0.0, -0.04, k), lerp(0.82, 0.52, k))
    shoulder = polar(hip, lerp(86.0, 78.0, k), TORSO)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=polar(shoulder, -80.0, 0.52),
            elbow_bend=-1.0,
            ankle=(0.20, 0.0),
            free_leg=(-0.56, 0.52),
            free_foot="point",
            free_toe=-1.0,
            free_knee_bend=1.0,
            head_lean=-2.0,
        ),
    )


def chair_squat(canvas: Canvas, t: float) -> None:
    """LG6. На одной ноге таз назад до касания стула — коснулся и сразу встал."""
    k = rep(t, 0.42, 0.04, 0.30)
    canvas.chair((-0.36, 0.46), half_width=0.20, back=-1)
    hip = (lerp(0.0, -0.22, k), lerp(0.83, 0.56, k))
    shoulder = polar(hip, lerp(86.0, 60.0, k), TORSO)
    free = polar(hip, lerp(-60.0, -8.0, k), LEG * 0.98)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=straight_arm(shoulder, lerp(-20.0, -6.0, k), 0.96),
            ankle=(0.02, 0.0),
            free_leg=free,
            free_foot="flex",
            free_toe=1.0,
            head_lean=lerp(0.0, 22.0, k),
        ),
    )


def calf_raise(canvas: Canvas, t: float) -> None:
    """LG7. Пальцы на стене для баланса, подъём на носок, пауза, спуск на три счёта."""
    k = rep(t, 0.20, 0.14, 0.44)
    canvas.wall(0.56)
    rise = k * 0.10
    hip = (0.0, 0.82 + rise)
    shoulder = polar(hip, 90.0, TORSO)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(0.52, shoulder[1] - 0.06),
            elbow_bend=-1.0,
            ankle=(0.0, rise),
            foot="toes" if k > 0.08 else "flat",
            free_leg=(-0.24, 0.30 + rise),
            free_knee_bend=1.0,
            free_foot="point",
        ),
    )
    # Медленный спуск — самая полезная часть повтора.
    if 0.47 < t < 0.87:
        canvas.arrow((0.26, 0.36 + rise), (0.26, 0.20 + rise))


def bridge(t: float) -> Pose:
    """PC8. Толчок пятками, таз до прямой колено — таз — плечо, голова на полу."""
    k = lift(t)
    hip = (-0.16, lerp(0.12, 0.40, k))
    shoulder = (0.34, 0.11)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(-0.14, 0.035),
        elbow=(0.10, 0.045),
        ankle=(-0.54, 0.0),
        knee_bend=-1.0,
        toe=-1.0,
        facing=-1.0,
        head_angle=0.0,
        guide=(shoulder, ik(hip, (-0.54, 0.0), THIGH, SHIN, -1.0)) if k > 0.7 else None,
    )


def hip_flexor_stretch(t: float) -> Pose:
    """MB7. Колено сзади на полу, таз подкручен под себя и мягко уходит вперёд."""
    k = settle(t)
    hip = (lerp(-0.02, 0.10, k), 0.58)
    shoulder = polar(hip, 92.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(hip[0] + 0.02, hip[1] + 0.04),
        elbow_bend=1.0,
        ankle=(0.44, 0.0),
        free_leg=(-0.72, 0.04),
        free_knee=(-0.28, 0.06),
        free_foot="point",
        free_toe=-1.0,
        breath=breath(t) * 0.6,
        arrow=((hip[0] - 0.40, hip[1] - 0.05), (hip[0] - 0.18, hip[1] - 0.05)) if k > 0.4 else None,
    )


def superman(t: float) -> Pose:
    """PC6. Руки, грудь и ноги отрываются одновременно, взгляд в пол."""
    k = lift(t)
    hip = (-0.22, 0.10)
    shoulder = (0.30, 0.12 + 0.08 * k)
    arm_angle = 6.0 * k + angle_of(hip, shoulder)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, arm_angle, 0.98),
        ankle=polar(hip, 180.0 - 9.0 * k, LEG * 0.98),
        foot="point",
        toe=-1.0,
        curve=-0.04 * k,
        head_lean=-14.0,
        arrow=((1.02, 0.10), (1.02, 0.28)) if k > 0.5 else None,
    )


def dead_bug(t: float) -> Pose:
    """CR6. Руки в потолок, колени над тазом; рука за голову и противоположная нога вперёд."""
    k = settle(t)
    shoulder = (0.30, 0.11)
    hip = (-0.22, 0.11)
    reach = straight_arm(shoulder, lerp(90.0, 14.0, k))
    knee = polar(hip, lerp(90.0, 170.0, k), THIGH)
    ankle = polar(knee, lerp(180.0, 176.0, k), SHIN)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=reach,
        far_wrist=straight_arm(shoulder, 90.0),
        ankle=(hip[0] - 0.40 + 0.04, 0.51),
        knee=(hip[0] + 0.02, 0.51),
        foot="point",
        free_leg=ankle,
        free_knee=knee,
        free_foot="point",
        toe=-1.0,
        facing=-1.0,
        head_angle=0.0,
        guide=((-0.36, 0.012), (0.34, 0.012)),
    )


def get_up(t: float) -> Pose:
    """CR5. Перекат на предплечье, потом на ладонь; рука с гирей всё время вертикально."""
    k = rep(t, 0.40, 0.18, 0.36)
    hip = (-0.12, 0.11)
    angle = lerp(0.0, 58.0, min_jerk(k))
    shoulder = polar(hip, angle, TORSO)
    support_hand = (0.12, 0.04)
    elbow_on_floor = k < 0.45
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(shoulder[0], shoulder[1] + ARM * 0.97),
        bell=0.07,
        bell_hang=(-0.6, -0.8),
        ankle=(-0.52, 0.0),
        knee_bend=-1.0,
        toe=-1.0,
        free_leg=(-0.92, 0.04),
        free_foot="flex",
        free_toe=-1.0,
        far_wrist=support_hand,
        far_elbow=((0.12, 0.06) if elbow_on_floor else None),
        far_elbow_bend=1.0,
        facing=-1.0,
        head_lean=26.0 * min(1.0, k * 1.6),
    )


def towel_extension(canvas: Canvas, t: float) -> None:
    """MB1. Валик под лопатками, ладони на затылке: грудной отдел раскрывается через валик."""
    k = settle(t)
    canvas.roll((0.14, 0.09), radius=0.09)
    hip = (-0.34, 0.11)
    shoulder = (0.34, lerp(0.30, 0.20, k))
    head = polar(shoulder, lerp(28.0, -12.0, k), 0.18)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(head[0] + 0.06, head[1] - 0.04),
            elbow=(shoulder[0] + 0.12, shoulder[1] + 0.26),
            ankle=(-0.78, 0.0),
            knee_bend=-1.0,
            toe=-1.0,
            facing=-1.0,
            curve=lerp(0.02, 0.07, k),
            head_angle=lerp(28.0, -14.0, k),
            breath=breath(t) * 0.5,
            guide=((-0.40, 0.012), (0.02, 0.012)),
        ),
    )


def quadruped(**kwargs) -> Pose:
    """Четвереньки в профиль: кисти под плечами, колени под тазом."""
    kwargs.setdefault("hip", (-0.32, 0.62))
    kwargs.setdefault("shoulder", (0.30, 0.64))
    kwargs.setdefault("wrist", (0.32, 0.06))
    kwargs.setdefault("ankle", (-0.74, 0.05))
    kwargs.setdefault("knee", (-0.30, 0.06))
    kwargs.setdefault("head_lean", -12.0)
    return Pose(foot="point", toe=-1.0, **kwargs)


def cat_cow(t: float) -> Pose:
    """MB3. Кошка и корова: спина округляется и прогибается, шея работает вместе с ней."""
    k = rep(t, 0.36, 0.14, 0.36)
    return quadruped(
        curve=lerp(0.10, -0.08, k),
        head_lean=lerp(-44.0, 12.0, k),
        neck_lean=lerp(-30.0, 8.0, k),
        breath=lerp(-0.5, 1.0, k),
    )


def bird_dog(t: float) -> Pose:
    """PC7. Ближняя рука вперёд, дальняя нога назад — в линию с корпусом, таз ровный."""
    k = settle(t)
    shoulder = (0.30, 0.64)
    hip = (-0.32, 0.62)
    hand = lerp_pt((0.32, 0.06), straight_arm(shoulder, 6.0), min_jerk(k))
    heel = lerp_pt((-0.74, 0.05), polar(hip, 178.0, LEG * 0.98), min_jerk(k))
    return quadruped(
        wrist=hand,
        elbow_bend=1.0,
        far_wrist=(0.32, 0.06),
        free_leg=heel,
        free_knee=None if k > 0.1 else (-0.30, 0.06),
        free_foot="point",
        free_toe=-1.0,
        guide=(hand, heel) if k > 0.7 else None,
    )


def thread_needle(t: float) -> Pose:
    """MB6. Рука продевается под корпусом, плечо и висок опускаются к полу, таз над коленями."""
    k = settle(t)
    shoulder = (0.30, lerp(0.64, 0.30, k))
    return quadruped(
        shoulder=shoulder,
        wrist=(lerp(0.32, 0.10, k), 0.06),
        elbow_bend=-1.0,
        arm_layer="behind" if k > 0.15 else "front",
        far_wrist=(0.40, 0.06),
        far_elbow_bend=-1.0,
        head_lean=lerp(-12.0, -40.0, k),
    )


def doorway_stretch(canvas: Canvas, t: float) -> None:
    """MB4. Предплечье на косяке, шаг вперёд — корпус уходит от руки, раскрывается грудь."""
    k = settle(t)
    jamb = 0.06
    canvas.wall(jamb, 2.2)
    hip = (lerp(-0.10, 0.10, k), 0.82)
    shoulder = polar(hip, 90.0, TORSO)
    elbow = (jamb, shoulder[1] - 0.02)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(jamb, shoulder[1] + 0.26),
            elbow=elbow,
            ankle=(lerp(0.10, 0.26, k), 0.0),
            free_leg=(-0.24, 0.0),
            free_foot="toes" if k > 0.5 else "flat",
            breath=breath(t) * 0.6,
            arrow=((hip[0] - 0.40, hip[1] + 0.12), (hip[0] - 0.18, hip[1] + 0.12)) if k > 0.4 else None,
        ),
    )


def ankle_stretch(canvas: Canvas, t: float) -> None:
    """MB8. Лицом к стене, колено едет к стене, пятка остаётся на полу."""
    k = rep(t, 0.30, 0.12, 0.30)
    canvas.wall(0.64)
    ankle = (0.34, 0.0)
    knee_x = lerp(0.40, 0.60, k)
    knee = (knee_x, math.sqrt(max(0.0, SHIN * SHIN - (knee_x - ankle[0]) ** 2)))
    hip = (lerp(-0.02, 0.08, k), 0.70)
    shoulder = polar(hip, lerp(86.0, 82.0, k), TORSO)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(0.60, shoulder[1] - 0.04),
            elbow_bend=-1.0,
            ankle=ankle,
            knee=knee,
            free_leg=(-0.36, 0.0),
            free_foot="toes",
        ),
    )
    canvas.arrow((knee[0] - 0.08, knee[1] + 0.14), (knee[0] + 0.04, knee[1] + 0.14))


def worlds_greatest(t: float) -> Pose:
    """MB5. Выпад, локоть к полу у стопы, потом раскрытие корпуса с рукой в потолок."""
    elbow_down = rep(t, 0.18, 0.18, 0.14)
    open_up = rep(t, 0.22, 0.24, 0.20, lag=0.26)
    hip = (-0.08, 0.46)
    shoulder = polar(hip, lerp(34.0, 44.0, open_up) - 6.0 * elbow_down, TORSO)
    reach = polar(shoulder, lerp(-94.0, 84.0, open_up), ARM * 0.97)
    if open_up < 0.05:
        reach = lerp_pt((shoulder[0] + 0.02, shoulder[1] - ARM * 0.97), (0.24, 0.06), elbow_down)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=reach,
        elbow_bend=-1.0 if open_up < 0.05 else 1.0,
        far_wrist=(shoulder[0] + 0.06, 0.04),
        ankle=(0.34, 0.0),
        free_leg=(-0.92, 0.02),
        free_foot="toes",
        free_toe=1.0,
        head_lean=lerp(-24.0, 20.0, open_up),
    )


def external_rotation(canvas: Canvas, t: float) -> None:
    """PR5. Лёжа на боку лицом к камере, локоть прижат к рёбрам, предплечье от живота к потолку.

    Предплечье вращается вокруг плеча и по дороге смотрит прямо в камеру: в середине
    оно короче, а кулак крупнее — так видно, что рука идёт на зрителя и вверх, а не вбок.
    """
    k = lift(t)
    theta = math.radians(lerp(-80.0, 85.0, k))
    pose = Front(pelvis=(-0.46, 0.22), neck=(0.12, 0.22), feet=((-1.34, 0.31), (-1.34, 0.13)))
    top, bottom = front_shoulders(pose)
    elbow = (top[0] - 0.28, top[1] + 0.01)
    wrist = (elbow[0], elbow[1] + math.sin(theta) * FOREARM)
    pose.hands = (wrist, (bottom[0] + 0.40, bottom[1] + 0.02))
    pose.elbow_at = (elbow, (bottom[0] + 0.24, bottom[1] - 0.01))
    pose.hand_scale = (1.0 + 0.35 * math.cos(theta), 1.0)
    pose.bells = (0.05, None)
    draw_front(canvas, pose)
    canvas.ring(elbow, 0.065, 0.014, ACCENT)


# --- Анфас и вид сверху ------------------------------------------------------


def prone_arms(mode: str) -> Draw:
    """SC1–SC3. Вид сверху на лежащего на животе: буква Y, T или W и тень, когда руки отрываются."""

    def draw(canvas: Canvas, t: float) -> None:
        k = lift(t)
        canvas.mat((-0.62, -1.32), (0.62, 0.86))
        pose = Front(pelvis=(0.0, -0.36), neck=(0.0, 0.26), back=True, lift=k * 0.07)
        shoulders = front_shoulders(pose)
        hands: list[Point] = []
        elbows: list[Point] = []
        for sign, shoulder in zip((-1, 1), shoulders):
            if mode == "Y":
                hands.append(polar(shoulder, 90.0 - sign * 34.0, ARM * 0.97))
                elbows.append((sign * 0.2, -1.0))
            elif mode == "T":
                hands.append((shoulder[0] + sign * ARM * 0.97, shoulder[1]))
                elbows.append((0.0, -1.0))
            else:
                hands.append((shoulder[0] + sign * lerp(0.20, 0.16, k), shoulder[1] + 0.24))
                elbows.append((sign * 1.0, -1.0))
        pose.hands = (hands[0], hands[1])
        pose.elbows = (elbows[0], elbows[1])
        pose.feet = ((-0.14, -1.18), (0.14, -1.18))
        scale = 1.0 + k * 0.12
        pose.hand_scale = (scale, scale)
        draw_front(canvas, pose)
        # Лопатки сводятся и уходят вниз — работает низ лопаток, а не шея.
        if k > 0.3:
            for sign in (-1, 1):
                canvas.arrow((sign * 0.13, 0.10), (sign * 0.04, 0.04))

    return draw


def wall_slide(canvas: Canvas, t: float) -> None:
    """SC4. Спиной к стене, предплечья на стене, руки скользят из W вверх в Y."""
    k = rep(t, 0.34, 0.08, 0.40)
    pose = Front(pelvis=(0.0, 0.84), neck=(0.0, 1.40))
    shoulders = front_shoulders(pose)
    hands = []
    for sign, shoulder in zip((-1, 1), shoulders):
        hands.append((shoulder[0] + sign * lerp(0.28, 0.20, k), shoulder[1] + lerp(0.30, 0.54, k)))
    pose.hands = (hands[0], hands[1])
    pose.elbows = ((-1.0, -0.4), (1.0, -0.4))
    pose.feet = ((-0.12, 0.04), (0.12, 0.04))
    draw_front(canvas, pose)


def reverse_fly(canvas: Canvas, t: float) -> None:
    """SC10. Наклон к камере: гири висят под плечами и расходятся в стороны до уровня плеч."""
    k = lift(t)
    pose = Front(
        pelvis=(0.0, 0.86),
        neck=(0.0, 1.20),
        head_drop=0.20,
        nod=1.0,
        feet=((-0.14, 0.04), (0.14, 0.04)),
        bells=(0.055, 0.055),
    )
    hands = []
    for sign, shoulder in zip((-1, 1), front_shoulders(pose)):
        a = math.radians(lerp(2.0, 82.0, k))
        hands.append((shoulder[0] + sign * math.sin(a) * ARM * 0.92, shoulder[1] - math.cos(a) * ARM * 0.92))
    pose.hands = (hands[0], hands[1])
    pose.elbows = ((-1.0, 0.3), (1.0, 0.3))
    draw_front(canvas, pose)


def halo(canvas: Canvas, t: float) -> None:
    """SC6. Гиря дном вверх идёт кругом близко к голове, голова и шея неподвижны."""
    theta = 2 * math.pi * t
    pose = Front(pelvis=(0.0, -0.56), neck=(0.0, 0.04))
    head = front_head_center(pose)
    depth = math.sin(theta)
    bell = (0.25 * math.cos(theta), head[1] - 0.14 + 0.10 * depth)
    pose.hands = ((bell[0] - 0.05, bell[1] - 0.05), (bell[0] + 0.05, bell[1] - 0.05))
    pose.elbows = ((-1.0, -0.8), (1.0, -0.8))
    behind = depth > 0.15
    pose.behind_head = (behind, behind)

    def kettlebell() -> None:
        canvas.kettlebell((bell[0], bell[1] - 0.05), 0.075, hang=(0.0, 1.0))

    if behind:
        kettlebell()
        draw_front(canvas, pose)
    else:
        draw_front(canvas, pose, extra=kettlebell)


def side_plank(canvas: Canvas, t: float) -> None:
    """CR2. Анфас: локоть под плечом, стопы одна на другой, таз поднимается до прямой линии."""
    k = rep(t, 0.30, 0.34, 0.20)
    feet = (-0.90, 0.12)
    along = polar((0.0, 0.0), 17.0, 1.0)
    across = (-along[1], along[0])
    line_pelvis = add(feet, along, LEG)
    pelvis = add(line_pelvis, across, -(1.0 - k) * 0.14)
    pose = Front(pelvis=pelvis, neck=add(line_pelvis, along, 0.60))
    _, side, _ = front_axes(pose)
    shoulders = front_shoulders(pose)
    low = 0 if shoulders[0][1] < shoulders[1][1] else 1
    hands: list[Point | None] = [None, None]
    elbow_at: list[Point | None] = [None, None]
    elbows: list[Point] = [across, across]
    hands[low] = (shoulders[low][0] + 0.26, 0.05)
    elbow_at[low] = (shoulders[low][0], 0.06)
    # Верхняя рука на бедре.
    hands[1 - low] = add(pelvis, side, -0.16 if low == 1 else 0.16)
    pose.hands = (hands[0], hands[1])
    pose.elbow_at = (elbow_at[0], elbow_at[1])
    pose.elbows = (elbows[0], elbows[1])
    pose.feet = (add(feet, side, -0.06), add(feet, side, 0.06))
    if k > 0.6:
        canvas.bone(add(feet, along, -0.06), add(feet, along, BODY + 0.30), 0.014, ACCENT)
    draw_front(canvas, pose)
    if 0.06 < t < 0.40:
        canvas.arrow((pelvis[0], pelvis[1] - 0.30), (pelvis[0], pelvis[1] - 0.12))


Point3 = tuple[float, float, float]


class Ortho:
    """Параллельная проекция 3D-сцены: камера сверху-сбоку, пол — в перспективе.

    Нужна там, где плоский силуэт врёт: лежащий на боку сверху совпадает с
    четвереньками, повёрнутый — с сидящим. В косом ракурсе пол виден как пол.
    Координаты: x вдоль тела к голове, y назад (к спине), z вверх от пола.
    """

    def __init__(self, azimuth: float, elevation: float) -> None:
        az, el = math.radians(azimuth), math.radians(elevation)
        self.toward = (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))
        f = tuple(-c for c in self.toward)
        right = (f[1], -f[0], 0.0)
        norm = math.hypot(right[0], right[1]) or 1.0
        self.right = (right[0] / norm, right[1] / norm, 0.0)
        r = self.right
        self.up = (r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0])

    def __call__(self, p: Point3) -> Point:
        return (sum(a * b for a, b in zip(p, self.right)), sum(a * b for a, b in zip(p, self.up)))

    def depth(self, *points: Point3) -> float:
        """Чем больше, тем ближе к камере: рисуется позже."""
        return sum(sum(a * b for a, b in zip(p, self.toward)) for p in points) / len(points)


def v3(a: Point3, b: Point3, k: float = 1.0) -> Point3:
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def around_spine(v: Point3, angle: float) -> Point3:
    """Поворот вокруг оси позвоночника (x): грудь от «вперёд» (−y) к потолку (+z)."""
    return (v[0], v[1] * math.cos(angle) + v[2] * math.sin(angle), -v[1] * math.sin(angle) + v[2] * math.cos(angle))


OPEN_BOOK_VIEW = Ortho(azimuth=-38.0, elevation=40.0)


def open_book(canvas: Canvas, t: float) -> None:
    """MB2. Лёжа на боку, колени стоят; верхняя рука дугой уходит назад, грудь раскрывается за ней.

    Камера сверху со стороны головы: коврик виден полом, дуга руки — дугой, а таз
    и колени остаются боком, пока грудь разворачивается к потолку. Сцена — в трёх
    измерениях, по одной точке на сустав; дальние части рисуются раньше ближних.
    """
    k = rep(t, 0.34, 0.16, 0.34)
    # Грудь догоняет руку, а голова — грудь: взгляд следует за рукой.
    chest = math.radians(lerp(0.0, 78.0, rep(t, 0.34, 0.16, 0.34, lag=0.03)))
    gaze = math.radians(lerp(0.0, 140.0, rep(t, 0.34, 0.16, 0.34, lag=0.05)))
    # В начале верхняя рука лежит на нижней: направлена вперёд и вниз, к полу.
    reach = math.radians(lerp(-34.0, 176.0, k))
    view = OPEN_BOOK_VIEW

    corners = [(-1.02, -0.74, 0.0), (0.68, -0.74, 0.0), (0.68, 0.62, 0.0), (-1.02, 0.62, 0.0)]
    canvas.poly([view(p) for p in corners], SHADOW)

    hip_low, hip_top = (-0.40, 0.0, 0.08), (-0.40, 0.0, 0.26)
    center = (0.18, 0.0, 0.05 + SHOULDER_W * math.cos(chest))
    shoulder_top = v3(center, around_spine((0.0, 0.0, SHOULDER_W), chest))
    shoulder_low = v3(center, around_spine((0.0, 0.0, -SHOULDER_W), chest))
    head = (0.44, 0.0, center[2] * 0.8 + 0.02)
    face = around_spine((0.0, -1.0, 0.0), gaze)
    direction = around_spine((0.0, -1.0, 0.0), reach)
    hand = v3(shoulder_top, direction, ARM * 0.97)
    hand = (hand[0], hand[1], max(0.05, hand[2]))

    items: list[tuple[float, Callable[[], None]]] = []

    def leg(hip: Point3, knee: Point3, ankle: Point3, tone: Tone) -> None:
        def draw() -> None:
            canvas.limb(view(knee), view(ankle), SHIN_R, tone.pants)
            canvas.limb(view(hip), view(knee), THIGH_R, tone.pants)
            canvas.limb(view(ankle), view(v3(ankle, (-0.14, 0.0, -0.02))), FOOT_R, tone.shoe)

        items.append((view.depth(hip, knee, ankle), draw))

    # Колени согнуты под прямым углом вперёд и лежат друг на друге.
    leg(hip_low, (-0.36, -0.42, 0.06), (-0.80, -0.44, 0.05), FAR)
    leg(hip_top, (-0.36, -0.42, 0.18), (-0.80, -0.44, 0.16), NEAR)

    def torso() -> None:
        quad = [hip_low, shoulder_low, shoulder_top, hip_top]
        canvas.poly([view(p) for p in quad], SHIRT)
        for a, b in ((hip_low, shoulder_low), (hip_top, shoulder_top)):
            canvas.limb(view(a), view(b), [(0.0, 0.09), (1.0, 0.075)], SHIRT)
        waist = [hip_low, lerp3(hip_low, shoulder_low, WAIST_S), lerp3(hip_top, shoulder_top, WAIST_S), hip_top]
        canvas.poly([view(p) for p in waist], PANTS)
        canvas.limb(view(hip_low), view(hip_top), [(0.0, 0.08), (1.0, 0.08)], PANTS)

    items.append((view.depth(hip_low, hip_top, shoulder_low, shoulder_top), torso))

    def bottom_arm() -> None:
        draw_arm(canvas, view(shoulder_low), view((0.24, -0.60, 0.04)), FAR, elbow=view((0.22, -0.32, 0.04)))

    items.append((view.depth(shoulder_low, (0.24, -0.60, 0.04)), bottom_arm))

    def head_and_neck() -> None:
        canvas.limb(view(center), view(head), [(0.0, 0.045), (1.0, 0.04)], SKIN)
        c = view(head)
        canvas.disc(c, HEAD_R, HAIR)
        facing = sum(a * b for a, b in zip(face, view.toward))
        if facing > -0.3:
            # Лицо — кружок кожи, сдвинутый туда, куда оно смотрит: анфас — в центре, в профиль — с краю.
            f = view(v3(head, face, HEAD_R * 0.5))
            canvas.disc(f, HEAD_R * 0.80, SKIN)
            nose = view(v3(head, face, HEAD_R * 1.02))
            canvas.disc(nose, 0.024, SKIN)
            if facing > 0.25:
                side = (0.0, face[2], -face[1])
                for sign in (-1, 1):
                    eye = view(v3(v3(head, face, HEAD_R * 0.75), side, sign * HEAD_R * 0.36))
                    canvas.disc(eye, 0.013, INK)

    items.append((view.depth(head), head_and_neck))

    def top_arm() -> None:
        # Тень на коврике: рука оторвана от пола тем сильнее, чем ближе к потолку.
        canvas.limb(view((shoulder_top[0], shoulder_top[1], 0.0)), view((hand[0], hand[1], 0.0)), FOREARM_R, MUTED)
        draw_arm(canvas, view(shoulder_top), view(hand), NEAR, elbow=view(lerp3(shoulder_top, hand, 0.52)), gap=0.014)

    items.append((view.depth(shoulder_top, hand) + 0.05, top_arm))

    for _, draw in sorted(items, key=lambda item: item[0]):
        draw()

    if 0.14 < t < 0.44:
        # Дуга над рукой: вперёд по полу → в потолок → назад на пол.
        pivot = (0.18, 0.0, 0.05 + SHOULDER_W)
        arc = [view(v3(pivot, around_spine((0.0, -1.0, 0.0), math.radians(a)), ARM + 0.16)) for a in range(60, 161, 10)]
        for a, b in zip(arc, arc[1:-1]):
            canvas.bone(a, b, 0.024, ACCENT)
        canvas.arrow(arc[-2], arc[-1])


def shoulder_level(canvas: Canvas, shoulder: Point, reach: float) -> None:
    """Пунктир на уровне плеча: выше рука не идёт."""
    for index in range(6):
        x0 = shoulder[0] + reach * index / 6
        canvas.bone((x0, shoulder[1]), (x0 + reach / 12, shoulder[1]), 0.008, ACCENT)


def lateral_raise(canvas: Canvas, t: float) -> None:
    """PR7. Гиря в сторону и чуть вперёд до уровня плеча; локоть мягкий, плечо не к уху.

    Вверх бодро, вниз втрое медленнее — как в дозе «1 с вверх, 3 с вниз».
    """
    k = rep(t, 0.18, 0.06, 0.54)
    pose = Front(
        pelvis=(0.0, 0.84),
        neck=(0.0, 1.40),
        feet=((-0.12, 0.04), (0.12, 0.04)),
        bells=(None, 0.055),
    )
    shoulder = front_shoulders(pose)[1]
    a = math.radians(lerp(8.0, 88.0, k))
    hand = (shoulder[0] + math.sin(a) * ARM * 0.93, shoulder[1] - math.cos(a) * ARM * 0.93)
    pose.hands = (None, hand)
    pose.elbows = ((-1.0, -0.6), (0.4, -1.0))
    shoulder_level(canvas, shoulder, ARM * 1.05)
    draw_front(canvas, pose)


def overhead_shrug(canvas: Canvas, t: float) -> None:
    """SC11. Прямые руки с гирями буквой Y; плечи тянутся к ушам и медленно опускаются.

    Руки не сгибаются и не опускаются: двигаются только лопатки, поэтому руки едут
    вверх ровно на ход плеч.
    """
    k = rep(t, 0.20, 0.36, 0.20)
    pose = Front(
        pelvis=(0.0, 0.84),
        neck=(0.0, 1.40),
        feet=((-0.13, 0.04), (0.13, 0.04)),
        bells=(0.05, 0.05),
        shrug=lerp(-0.05, 0.16, k),
    )
    hands = []
    for sign, shoulder in zip((-1, 1), front_shoulders(pose)):
        a = math.radians(22.0)
        hands.append((shoulder[0] + sign * math.sin(a) * ARM * 0.96, shoulder[1] + math.cos(a) * ARM * 0.96))
    pose.hands = (hands[0], hands[1])
    pose.elbows = ((-1.0, 0.2), (1.0, 0.2))
    draw_front(canvas, pose)


def serratus_punch(t: float) -> Pose:
    """SC12. Лёжа, рука с гирей прямая в потолок; лопатка выталкивает гирю выше, локоть прямой."""
    k = rep(t, 0.24, 0.24, 0.30)
    shoulder = (0.28, lerp(0.11, 0.20, k))
    return supine(
        shoulder=shoulder,
        wrist=straight_arm(shoulder, 90.0),
        bell=0.07,
        bell_hang=(0.35, -0.9),
        guide=((0.28 + 0.07, 0.11 + ARM * 0.9), (0.28 + 0.07, 0.11 + ARM * 1.02)),
    )


def shrug_drop(canvas: Canvas, t: float) -> None:
    """NK11. Плечи к ушам, задержка — и сброс одним движением; потом долго висят расслабленно."""
    if t < 0.22:
        k = min_jerk(t / 0.22)
    elif t < 0.46:
        k = 1.0
    elif t < 0.52:
        k = 1.0 - (t - 0.46) / 0.06
    else:
        k = 0.0
    pose = Front(pelvis=(0.0, -0.56), neck=(0.0, 0.04), shrug=lerp(-0.05, 0.16, k))
    draw_front(canvas, pose)
    if 0.46 <= t < 0.66:
        # Стрелки вниз в момент сброса: плечи падают, а не опускаются с усилием.
        for sign, shoulder in zip((-1, 1), front_shoulders(pose)):
            top = add(shoulder, (sign * 0.10, 0.0))
            bottom = add(top, (0.0, -0.12))
            canvas.bone(top, bottom, 0.012, ACCENT)
            canvas.bone(bottom, add(bottom, (-0.03, 0.04)), 0.012, ACCENT)
            canvas.bone(bottom, add(bottom, (0.03, 0.04)), 0.012, ACCENT)


def lerp3(a: Point3, b: Point3, k: float) -> Point3:
    return (lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k))


# --- Реестр -----------------------------------------------------------------

STAND = Camera()
LYING = Camera(origin_x=0.52, origin_y=0.64, zoom=1.08)
PRONE = Camera(origin_x=0.55, origin_y=0.64, zoom=1.0)
HEAD = Camera(origin_x=0.44, origin_y=0.78, zoom=2.1, ground=False)
HEAD_FRONT = Camera(origin_x=0.5, origin_y=0.80, zoom=2.0, ground=False)
TOPDOWN = Camera(origin_x=0.5, origin_y=0.46, zoom=0.88, ground=False)


@dataclass
class Demo:
    title: str
    draw: Draw
    camera: Camera = field(default_factory=Camera)


DEMOS: dict[str, Demo] = {
    # Шея
    "NK1": Demo("Подбородок назад", chin_tuck, HEAD),
    "NK2": Demo("Изометрия: сгибание", neck_isometric(1), HEAD),
    "NK3": Demo("Изометрия: разгибание", neck_isometric(-1), HEAD),
    "NK4": Demo("Изометрия: вбок", neck_press_side, HEAD_FRONT),
    "NK5": Demo("Изометрия: ротация", neck_press_rotation, HEAD_FRONT),
    "NK6": Demo("Растяжка трапеции", neck_stretch(0.0, 0.0), HEAD_FRONT),
    "NK7": Demo("Растяжка леватора", neck_stretch(-0.6, 0.8), HEAD_FRONT),
    "NK8": Demo("Подъём головы лёжа", figure(supine_head_lift), LYING),
    "NK9": Demo("Разгибатели лёжа", figure(prone_head_lift), PRONE),
    "NK10": Demo("Дыхание 90/90", breathing_90_90, Camera(origin_x=0.56, origin_y=0.72, zoom=0.95)),
    "NK11": Demo("Подъём и сброс плеч", shrug_drop, Camera(origin_x=0.5, origin_y=0.52, zoom=1.7, ground=False)),
    # Лопатки
    "SC1": Demo("Prone Y", prone_arms("Y"), TOPDOWN),
    "SC2": Demo("Prone T", prone_arms("T"), TOPDOWN),
    "SC3": Demo("Prone W", prone_arms("W"), TOPDOWN),
    "SC4": Demo("Скольжение по стене", wall_slide, Camera(origin_x=0.5, origin_y=0.9, zoom=0.86)),
    "SC6": Demo("Halo с гирей", halo, Camera(origin_x=0.5, origin_y=0.84, zoom=1.7, ground=False)),
    "SC8": Demo("Вис на турнике", with_bar(bar_hang), Camera(origin_x=0.5, origin_y=0.96, zoom=0.7, ground=False)),
    "SC9": Demo("Пуловер лёжа", figure(pullover), LYING),
    "SC10": Demo("Обратная «муха»", reverse_fly, Camera(origin_x=0.5, origin_y=0.9, zoom=0.9)),
    "SC11": Demo("Шраги с руками вверху", overhead_shrug, Camera(origin_x=0.5, origin_y=0.94, zoom=0.8)),
    "SC12": Demo("Вынос гири вверх лёжа", figure(serratus_punch), LYING),
    # Тяги
    "RW1": Demo("Тяга одной рукой", bent_row, Camera(origin_x=0.44, origin_y=0.86, zoom=0.95)),
    "RW2": Demo("Тяга двумя гирями", figure(gorilla_row), Camera(origin_x=0.44, zoom=1.0)),
    "RW5": Demo("Тяга лёжа на животе", figure(prone_row), PRONE),
    "RW6": Demo("Подтягивания", with_bar(pullup), Camera(origin_x=0.5, origin_y=0.96, zoom=0.7, ground=False)),
    "RW7": Demo("Тяга под столом", table_row, Camera(origin_x=0.46, origin_y=0.84, zoom=0.86)),
    "RW8": Demo("Тяга рюкзака", backpack_row, Camera(origin_x=0.44, zoom=0.95)),
    # Задняя цепь
    "PC1": Demo("Румынская тяга", figure(romanian_deadlift), Camera(origin_x=0.46)),
    "PC2": Demo("Румынская на одной ноге", figure(single_leg_deadlift), Camera(origin_x=0.5, zoom=0.9)),
    "PC3": Demo("Свинг двумя руками", figure(swing), Camera(origin_x=0.46)),
    "PC4": Demo("Свинг одной рукой", figure(swing_one_hand), Camera(origin_x=0.46)),
    "PC5": Demo("Good morning", figure(good_morning), Camera(origin_x=0.44)),
    "PC6": Demo("Superman", figure(superman), PRONE),
    "PC7": Demo("Bird dog", figure(bird_dog), Camera(origin_x=0.52, origin_y=0.8, zoom=0.82)),
    "PC8": Demo("Ягодичный мостик", figure(bridge), LYING),
    "PC9": Demo("Становая с рюкзаком", backpack_deadlift, Camera(origin_x=0.46)),
    # Жимы и ротаторы
    "PR1": Demo("Жим стоя", figure(overhead_press), Camera(origin_x=0.44, origin_y=0.9, zoom=0.86)),
    "PR3": Demo("Отжимания", figure(pushup), Camera(origin_x=0.5, origin_y=0.74, zoom=1.08)),
    "PR4": Demo("Жим лёжа на полу", figure(floor_press), LYING),
    "PR5": Demo("Внешняя ротация", external_rotation, Camera(origin_x=0.64, origin_y=0.66, zoom=0.95)),
    "PR6": Demo("Y-raise в наклоне", figure(y_raise), Camera(origin_x=0.4, zoom=0.9)),
    "PR7": Demo("Подъём гири в сторону", lateral_raise, Camera(origin_x=0.42, origin_y=0.9, zoom=0.86)),
    # Ноги
    "LG2": Demo("Выпад назад", figure(back_lunge), Camera(origin_x=0.56, zoom=0.9)),
    "LG4": Demo("Болгарский присед", bulgarian_squat, Camera(origin_x=0.58, zoom=0.9)),
    "LG5": Demo("Присед", figure(squat), STAND),
    "LG6": Demo("Присед к стулу", chair_squat, Camera(origin_x=0.46, zoom=0.9)),
    "LG7": Demo("Подъём на носок", calf_raise, Camera(origin_x=0.44, zoom=0.9)),
    # Корпус
    "CR1": Demo("Планка", figure(plank), Camera(origin_x=0.54, origin_y=0.72, zoom=1.08)),
    "CR2": Demo("Боковая планка", side_plank, Camera(origin_x=0.52, origin_y=0.78, zoom=0.9)),
    "CR3": Demo("Чемоданная переноска", figure(suitcase_carry), STAND),
    "CR4": Demo("Фермерская переноска", figure(farmer_carry), STAND),
    "CR5": Demo("Turkish get-up", figure(get_up), Camera(origin_x=0.56, origin_y=0.84, zoom=0.95)),
    "CR6": Demo("Dead bug", figure(dead_bug), PRONE),
    "CR7": Demo("Rack carry", figure(rack_carry), STAND),
    "CR8": Demo("Переноска рюкзака", figure(backpack_carry), STAND),
    # Мобильность
    "MB1": Demo("Грудной отдел на полотенце", towel_extension, LYING),
    "MB2": Demo("Open book", open_book, Camera(origin_x=0.565, origin_y=0.45, zoom=1.0, ground=False)),
    "MB3": Demo("Cat-cow", figure(cat_cow), Camera(origin_x=0.52, origin_y=0.8, zoom=0.82)),
    "MB4": Demo("Растяжка груди в проёме", doorway_stretch, Camera(origin_x=0.46, zoom=0.9)),
    "MB5": Demo("World's greatest stretch", figure(worlds_greatest), Camera(origin_x=0.52, origin_y=0.84, zoom=0.82)),
    "MB6": Demo("Thread the needle", figure(thread_needle), Camera(origin_x=0.52, origin_y=0.8, zoom=0.82)),
    "MB7": Demo("Растяжка сгибателей бедра", figure(hip_flexor_stretch), Camera(origin_x=0.5, zoom=0.86)),
    "MB8": Demo("Растяжка голеностопа", ankle_stretch, Camera(origin_x=0.4, zoom=0.88)),
    "MB9": Demo("Прогулка", figure(walk), STAND),
}


# Палитра фиксированная, общая для всех кадров: без неё соседние кадры квантуются
# по-разному, цвета мигают, а дельты между кадрами раздуваются.
BASE_COLORS = [BG, INK, SKIN, SKIN_FAR, HAIR, SHIRT, SHIRT_FAR, PANTS, PANTS_FAR, MUTED, SHADOW, ACCENT]
BLENDS = [
    (SKIN, SHIRT),
    (SKIN, PANTS),
    (SHIRT, PANTS),
    (SKIN, HAIR),
    (SKIN, INK),
    (PANTS, INK),
    (SHIRT, INK),
    (SHIRT_FAR, SHIRT),
    (PANTS_FAR, PANTS),
    (SKIN_FAR, SKIN),
]


def palette_image() -> Image.Image:
    colors = list(BASE_COLORS)
    for color in BASE_COLORS[1:]:
        colors.append(tuple((a + b) // 2 for a, b in zip(color, BG)))
    for a, b in BLENDS:
        colors.append(tuple((x + y) // 2 for x, y in zip(a, b)))
    flat: list[int] = []
    for color in colors:
        flat.extend(color)
    flat.extend(flat[:3] * (256 - len(colors)))
    image = Image.new("P", (1, 1))
    image.putpalette(flat)
    return image


PALETTE = palette_image()


def render(code: str, demo: Demo) -> str:
    frames: list[Image.Image] = []
    for index in range(FRAMES):
        canvas = Canvas(demo.camera)
        if demo.camera.ground:
            canvas.ground()
        canvas.label(demo.title)
        demo.draw(canvas, index / FRAMES)
        frames.append(canvas.finish().quantize(palette=PALETTE, dither=Image.Dither.NONE))

    # Почти неподвижная схема — это не только скучно: Telegram не умеет собрать из неё
    # видео и возвращает файл документом вместо animation, а карточка ждёт анимацию.
    unique = len({frame.tobytes() for frame in frames})
    if unique < MIN_UNIQUE_FRAMES:
        raise SystemExit(
            f"{code}: движения почти нет — {unique} различных кадров из {FRAMES}. "
            f"Увеличь амплитуду в схеме."
        )

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{code}.gif")
    # Одинаковые соседние кадры Pillow склеивает в один с суммарной длительностью:
    # паузы в крайних точках повтора в размере файла почти ничего не стоят.
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=True,
    )
    return path


MODULE = "src/bot/ui/demos.generated.ts"


def write_module(codes: list[str]) -> None:
    """Список демонстраций для сборки воркера: гифки уезжают в бандл как бинарные модули.

    Рядом — отпечатки файлов: по ним бот понимает, что запомненный `file_id` относится
    к старой версии схемы, и отправляет новую (docs/03-data-model.md).
    """
    lines = [
        "// Сгенерировано `pnpm demos:build` из scripts/build_demos.py. Руками не править.",
        "",
    ]
    for code in codes:
        lines.append(f"import {code} from '../../../assets/demos/{code}.gif';")
    lines += [
        "",
        "/** Рисованные схемы движения, вшитые в воркер. Своего хостинга нет (ADR-014). */",
        "export const BUILTIN_DEMOS: Record<string, ArrayBuffer> = {",
    ]
    for code in codes:
        lines.append(f"  {code},")
    lines += [
        "};",
        "",
        "/** Отпечаток каждой схемы: сменился — кеш `file_id` устарел. */",
        "export const BUILTIN_DEMO_DIGESTS: Record<string, string> = {",
    ]
    for code in codes:
        with open(os.path.join(OUT_DIR, f"{code}.gif"), "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()[:16]
        lines.append(f"  {code}: '{digest}',")
    lines += ["};", ""]
    with open(MODULE, "w") as handle:
        handle.write("\n".join(lines))


def main() -> None:
    total = 0
    for code, demo in DEMOS.items():
        path = render(code, demo)
        size = os.path.getsize(path)
        total += size
        print(f"{path}  {demo.title}  {size // 1024} КБ")
    write_module(list(DEMOS))
    print(f"{MODULE}: {len(DEMOS)} схем, {total // 1024} КБ суммарно")


if __name__ == "__main__":
    main()
