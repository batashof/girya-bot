#!/usr/bin/env python3
"""Рисованные демонстрации упражнений: схематичная фигура, зацикленная анимация.

Не видео с человеком, а подсказка «куда двигаться»: линия спины, траектория снаряда,
что сгибается, а что остаётся неподвижным. Своих медиа мы не хостим (ADR-014) — эти
гифки лежат в репозитории и уходят в сборку воркера, поэтому каждый килобайт на счету:
кадров мало, палитра короткая, фон плоский.

Схема есть у каждого упражнения из шаблонов дней и лестниц — карточка тренировки
показывает её сама, без отдельной команды (docs/04-bot-ux.md).

Запуск: python3 scripts/build_demos.py  → assets/demos/<КОД>.gif
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = "assets/demos"

# Рисуем с запасом и уменьшаем: у Pillow нет сглаживания линий.
SUPERSAMPLE = 3
SIZE = 240
FRAMES = 14
FRAME_MS = 100
# Схема обходится горстью цветов; палитра пожиже — файл втрое легче.
PALETTE_COLORS = 8
# Ниже этого числа различных кадров гифка перестаёт быть анимацией для Telegram.
MIN_UNIQUE_FRAMES = 6

BG = (250, 249, 246)
INK = (32, 34, 38)
MUTED = (176, 178, 184)
ACCENT = (198, 72, 48)
BELL = (72, 78, 92)

# Пропорции тела в условных единицах; рост целиком ≈ 1.75.
SHIN = 0.44
THIGH = 0.40
TORSO = 0.52
UPPER_ARM = 0.32
FOREARM = 0.30
HEAD_R = 0.115
NECK = 0.09
FOOT = 0.17

Point = tuple[float, float]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_pt(a: Point, b: Point, t: float) -> Point:
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t))


def ease(t: float) -> float:
    """Плавный ход туда-обратно: 0 → 1 → 0, без рывка на стыке петли."""
    return 0.5 - 0.5 * math.cos(2 * math.pi * t)


def pulse(t: float, amount: float = 1.0) -> float:
    """Мелкое подрагивание для изометрии: движения нет, а усилие показать надо."""
    return amount * math.sin(4 * math.pi * t)


def polar(origin: Point, angle_deg: float, length: float) -> Point:
    a = math.radians(angle_deg)
    return (origin[0] + math.cos(a) * length, origin[1] + math.sin(a) * length)


def straight_arm(shoulder: Point, angle_deg: float, factor: float = 0.99) -> Point:
    """Запястье на прямой руке: свинг и румынская тяга руками не тянут."""
    return polar(shoulder, angle_deg, (UPPER_ARM + FOREARM) * factor)


def ik(root: Point, target: Point, l1: float, l2: float, bend: float) -> Point:
    """Сустав между двумя звеньями. `bend` = +1 или −1 — в какую сторону колено/локоть."""
    dx, dy = target[0] - root[0], target[1] - root[1]
    dist = math.hypot(dx, dy)
    reach = l1 + l2 - 1e-6
    if dist > reach:
        dist = reach
        scale = reach / max(math.hypot(dx, dy), 1e-6)
        dx, dy = dx * scale, dy * scale
    dist = max(dist, 1e-6)
    ux, uy = dx / dist, dy / dist
    x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    mid = (root[0] + ux * x, root[1] + uy * x)
    return (mid[0] - uy * h * bend, mid[1] + ux * h * bend)


FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)


@dataclass
class Pose:
    """Опорные точки фигуры в профиль. Лицом вправо."""

    hip: Point
    shoulder: Point
    wrist: Point
    ankle: Point
    head_lean: float = 0.0
    knee_bend: float = 1.0
    elbow_bend: float = 1.0
    # Снаряд в руках: None — нет, иначе радиус гири.
    bell: float | None = None
    # Вторая точка опоры (рука на стуле, ладонь на полу) — рисуется приглушённо.
    support: Point | None = None
    # Свободная нога (румынская тяга на одной ноге, шаг в переноске).
    free_leg: Point | None = None
    # Опора под рукой: стул или стол.
    prop: Point | None = None
    # Как опирается стопа: всей ступнёй, носком или никак (лёжа на спине).
    foot: str = "flat"
    # Подсказка-стрелка: (откуда, куда) в тех же координатах.
    arrow: tuple[Point, Point] | None = None
    # Ориентир: тонкая линия, вдоль которой должно идти тело.
    guide: tuple[Point, Point] | None = None
    # Ладонь-опора на голове: (точка, угол) — для изометрии шеи.
    palm: tuple[Point, float] | None = None


@dataclass
class Camera:
    """Кадрирование: у стоячих, лежачих и «по пояс» упражнений оно разное."""

    origin_x: float = 0.42
    origin_y: float = 0.88
    zoom: float = 1.0
    # Пол рисуется не везде: у лежащих на спине он и так под фигурой.
    ground: bool = True


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

    def bone(self, a: Point, b: Point, width: float = 0.035, color=INK) -> None:
        pa, pb = self.to_px(a), self.to_px(b)
        w = max(2, int(width * self.scale))
        self.draw.line([pa, pb], fill=color, width=w)
        for point in (pa, pb):
            r = w / 2
            self.draw.ellipse([point[0] - r, point[1] - r, point[0] + r, point[1] + r], fill=color)

    def circle(self, center: Point, radius: float, color=INK, fill=None) -> None:
        c = self.to_px(center)
        r = radius * self.scale
        self.draw.ellipse(
            [c[0] - r, c[1] - r, c[0] + r, c[1] + r],
            outline=color,
            fill=fill,
            width=max(2, int(0.028 * self.scale)),
        )

    def ground(self) -> None:
        y = self.to_px((0, 0))[1]
        self.draw.line([(0, y), (self.px, y)], fill=MUTED, width=max(2, int(0.018 * self.scale)))

    def wall(self, x: float) -> None:
        px = self.to_px((x, 0))[0]
        self.draw.line([(px, 0), (px, self.px)], fill=MUTED, width=max(2, int(0.02 * self.scale)))

    def bar(self, point: Point, half_width: float = 0.30) -> None:
        """Перекладина турника: короткий отрезок с двумя стойками вверх."""
        self.bone((point[0] - half_width, point[1]), (point[0] + half_width, point[1]), 0.025, MUTED)

    def chair(self, seat: Point, half_width: float = 0.16) -> None:
        self.bone((seat[0] - half_width, seat[1]), (seat[0] + half_width, seat[1]), 0.025, MUTED)
        for side in (-1, 1):
            x = seat[0] + side * (half_width - 0.04)
            self.bone((x, seat[1]), (x, 0.0), 0.02, MUTED)

    def arrow(self, a: Point, b: Point, color=ACCENT) -> None:
        pa, pb = self.to_px(a), self.to_px(b)
        w = max(2, int(0.022 * self.scale))
        self.draw.line([pa, pb], fill=color, width=w)
        angle = math.atan2(pb[1] - pa[1], pb[0] - pa[0])
        head = 0.075 * self.scale
        for side in (2.6, -2.6):
            tip = (pb[0] + math.cos(angle + side) * head, pb[1] + math.sin(angle + side) * head)
            self.draw.line([pb, tip], fill=color, width=w)

    def kettlebell(self, center: Point, radius: float) -> None:
        c = self.to_px(center)
        r = radius * self.scale
        self.draw.ellipse([c[0] - r, c[1] - r * 0.9, c[0] + r, c[1] + r * 1.1], fill=BELL)
        self.draw.arc(
            [c[0] - r * 0.72, c[1] - r * 2.0, c[0] + r * 0.72, c[1] - r * 0.2],
            start=200,
            end=340,
            fill=BELL,
            width=max(2, int(0.035 * self.scale)),
        )

    def backpack(self, center: Point, size: float = 0.17) -> None:
        c = self.to_px(center)
        r = size * self.scale
        self.draw.rounded_rectangle(
            [c[0] - r * 0.7, c[1] - r, c[0] + r * 0.7, c[1] + r],
            radius=r * 0.3,
            fill=BELL,
        )

    def palm(self, point: Point, angle_deg: float) -> None:
        """Ладонь: короткая толстая черта поперёк направления давления."""
        a = math.radians(angle_deg + 90)
        half = 0.11
        offset = (math.cos(a) * half, math.sin(a) * half)
        self.bone(
            (point[0] - offset[0], point[1] - offset[1]),
            (point[0] + offset[0], point[1] + offset[1]),
            width=0.045,
            color=INK,
        )

    def roll(self, center: Point, radius: float = 0.08) -> None:
        """Свёрнутое полотенце под лопатками."""
        self.circle(center, radius, color=MUTED)

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


def draw_figure(canvas: Canvas, pose: Pose) -> None:
    knee = ik(pose.hip, pose.ankle, THIGH, SHIN, pose.knee_bend)
    elbow = ik(pose.shoulder, pose.wrist, UPPER_ARM, FOREARM, pose.elbow_bend)

    torso_angle = math.degrees(
        math.atan2(pose.shoulder[1] - pose.hip[1], pose.shoulder[0] - pose.hip[0])
    )
    neck_top = polar(pose.shoulder, torso_angle + pose.head_lean, NECK)
    head = polar(neck_top, torso_angle + pose.head_lean, HEAD_R)

    if pose.guide is not None:
        canvas.bone(pose.guide[0], pose.guide[1], width=0.012, color=ACCENT)

    if pose.prop is not None:
        canvas.chair(pose.prop)

    if pose.support is not None:
        canvas.bone(pose.shoulder, pose.support, width=0.03, color=MUTED)

    if pose.free_leg is not None:
        knee2 = ik(pose.hip, pose.free_leg, THIGH, SHIN, pose.knee_bend)
        canvas.bone(pose.hip, knee2, width=0.03, color=MUTED)
        canvas.bone(knee2, pose.free_leg, width=0.03, color=MUTED)

    if pose.foot == "flat":
        canvas.bone(
            (pose.ankle[0] - FOOT * 0.3, pose.ankle[1]),
            (pose.ankle[0] + FOOT * 0.8, pose.ankle[1]),
            width=0.028,
        )
    elif pose.foot == "toes":
        # Упор на носки: пятка поднята, носок на полу.
        canvas.bone(pose.ankle, (pose.ankle[0] - FOOT * 0.7, 0.0), width=0.028)

    canvas.bone(pose.hip, knee)
    canvas.bone(knee, pose.ankle)
    canvas.bone(pose.hip, pose.shoulder, width=0.042)
    canvas.bone(pose.shoulder, elbow)
    canvas.bone(elbow, pose.wrist)
    canvas.bone(pose.shoulder, neck_top, width=0.03)
    canvas.circle(head, HEAD_R, fill=BG)

    if pose.bell is not None:
        canvas.kettlebell(pose.wrist, pose.bell)

    if pose.palm is not None:
        canvas.palm(*pose.palm)

    if pose.arrow is not None:
        canvas.arrow(pose.arrow[0], pose.arrow[1])


Draw = Callable[[Canvas, float], None]


def figure(pose_fn: Callable[[float], Pose]) -> Draw:
    """Обёртка для упражнений, которые целиком описываются позой профильной фигуры."""

    def draw(canvas: Canvas, t: float) -> None:
        draw_figure(canvas, pose_fn(t))

    return draw


# --- Голова и шея -----------------------------------------------------------
# Свой кадр: плечи на нуле, голова над ними. Профильная фигура здесь бесполезна —
# в ней голова размером с монету, а весь смысл в том, куда она едет.

HEAD_R_BIG = 0.30
SHOULDER_Y = 0.0
NECK_BASE_Y = 0.42
HEAD_Y = 1.05


def head_side(canvas: Canvas, head_x: float, head_y: float = HEAD_Y, nose: bool = True) -> None:
    """Голова в профиль, лицом вправо, на шее над плечом."""
    canvas.bone((-0.55, SHOULDER_Y), (0.45, SHOULDER_Y), width=0.06)
    neck_base = (head_x * 0.35, NECK_BASE_Y)
    canvas.bone((0.0, SHOULDER_Y), neck_base, width=0.055)
    canvas.bone(neck_base, (head_x, head_y - HEAD_R_BIG), width=0.055)
    canvas.circle((head_x, head_y), HEAD_R_BIG, fill=BG)
    if nose:
        canvas.bone(
            (head_x + HEAD_R_BIG * 0.7, head_y),
            (head_x + HEAD_R_BIG * 1.5, head_y - 0.02),
            width=0.04,
        )


NECK_TOP_Y = NECK_BASE_Y * 0.5


def head_center(tilt_deg: float) -> Point:
    """Где окажется голова при наклоне вбок. Нужна заранее: рука рисуется до головы."""
    neck_base = (0.0, NECK_TOP_Y)
    return polar(neck_base, 90.0 + tilt_deg, HEAD_Y - NECK_TOP_Y)


def head_front(canvas: Canvas, tilt_deg: float, turn: float = 0.0) -> Point:
    """Голова анфас с наклоном вбок. Рисуется последней: круг закрывает всё под собой."""
    neck_base = (0.0, NECK_TOP_Y)
    center = head_center(tilt_deg)
    canvas.bone((0.0, SHOULDER_Y), neck_base, width=0.055)
    canvas.bone(neck_base, lerp_pt(neck_base, center, 0.55), width=0.055)
    canvas.circle(center, HEAD_R_BIG, fill=BG)
    # Нос показывает, куда смотрит лицо: у ротации он уезжает вбок.
    canvas.circle((center[0] + turn * HEAD_R_BIG * 0.8, center[1] - 0.02), 0.035, fill=INK)
    return center


def shoulders(canvas: Canvas) -> None:
    canvas.bone((-0.62, SHOULDER_Y), (0.62, SHOULDER_Y), width=0.06)


def chin_tuck(canvas: Canvas, t: float) -> None:
    """NK1. Голова уезжает назад над плечом, подбородок скользит к горлу."""
    k = ease(t)
    head_x = lerp(0.62, 0.06, k)
    canvas.bone((0.0, 0.05), (0.0, HEAD_Y + HEAD_R_BIG), width=0.012, color=ACCENT)
    head_side(canvas, head_x)
    canvas.bone(
        (head_x + HEAD_R_BIG * 0.45, HEAD_Y - HEAD_R_BIG * 0.75),
        (head_x + HEAD_R_BIG * 1.05, HEAD_Y - HEAD_R_BIG * 0.62),
        width=0.03,
        color=MUTED,
    )
    canvas.arrow((head_x + 0.5, HEAD_Y + 0.45), (head_x + 0.06, HEAD_Y + 0.45))


def neck_press_front(canvas: Canvas, t: float) -> None:
    """NK2. Ладонь на лбу, голова давит навстречу. Движения нет — только усилие."""
    shake = pulse(t, 0.012)
    head_side(canvas, 0.10 + shake)
    canvas.palm((0.10 + HEAD_R_BIG + 0.10, HEAD_Y + 0.10), 0.0)
    canvas.arrow((0.10 + HEAD_R_BIG + 0.02, HEAD_Y + 0.10), (0.10 + HEAD_R_BIG + 0.13, HEAD_Y + 0.10))
    canvas.arrow((0.10 + HEAD_R_BIG + 0.24, HEAD_Y - 0.16), (0.10 + HEAD_R_BIG + 0.13, HEAD_Y - 0.16))


def neck_press_back(canvas: Canvas, t: float) -> None:
    """NK3. Ладони на затылке, давление назад."""
    shake = pulse(t, 0.012)
    head_side(canvas, 0.10 - shake)
    canvas.palm((0.10 - HEAD_R_BIG - 0.10, HEAD_Y + 0.10), 180.0)
    canvas.arrow((0.10 - HEAD_R_BIG - 0.02, HEAD_Y + 0.10), (0.10 - HEAD_R_BIG - 0.13, HEAD_Y + 0.10))
    canvas.arrow((0.10 - HEAD_R_BIG - 0.24, HEAD_Y - 0.16), (0.10 - HEAD_R_BIG - 0.13, HEAD_Y - 0.16))


def neck_press_side(canvas: Canvas, t: float) -> None:
    """NK4. Ладонь на виске, голова давит вбок. Плечо остаётся внизу."""
    shake = pulse(t, 0.02)
    tilt = shake * 20.0
    center = head_center(tilt)
    shoulders(canvas)
    palm_x = center[0] + HEAD_R_BIG + 0.11
    # Рука идёт от плеча вверх через локоть — иначе ладонь висит в воздухе.
    canvas.bone((0.58, SHOULDER_Y), (0.92, 0.44), width=0.032)
    canvas.bone((0.92, 0.44), (palm_x + 0.08, center[1] + 0.05), width=0.032)
    canvas.palm((palm_x, center[1] + 0.05), 0.0)
    head_front(canvas, tilt)
    canvas.arrow((center[0] + HEAD_R_BIG + 0.01, center[1] + 0.05), (palm_x - 0.05, center[1] + 0.05))
    canvas.arrow((0.62, SHOULDER_Y + 0.28), (0.62, SHOULDER_Y + 0.06))


def neck_press_rotation(canvas: Canvas, t: float) -> None:
    """NK5. Ладонь на скуле, попытка повернуть голову против сопротивления.

    Голова остаётся на месте — двигать в кадре нечего, кроме самого усилия. Поэтому
    заметно ходит стрелка, а голова только подрагивает: статичная гифка ещё и ломается
    у Telegram, который отдаёт такую обратно документом вместо анимации.
    """
    shake = pulse(t, 1.0)
    tilt = shake * 5.0
    center = head_center(tilt)
    shoulders(canvas)
    palm_x = center[0] + HEAD_R_BIG + 0.11
    canvas.bone((0.58, SHOULDER_Y), (0.92, 0.44), width=0.032)
    canvas.bone((0.92, 0.44), (palm_x + 0.08, center[1] - 0.02), width=0.032)
    canvas.palm((palm_x, center[1] - 0.02), 0.0)
    head_front(canvas, tilt, turn=0.35 + shake * 0.1)
    tail = 0.16 + 0.10 * abs(shake)
    canvas.arrow((palm_x - 0.05 - tail, center[1] - 0.02), (palm_x - 0.05, center[1] - 0.02))


def stretch_frame(canvas: Canvas, center: Point, hand: Point) -> None:
    """Общий каркас растяжек шеи: плечи, рука сверху и вторая рука под бедром."""
    shoulders(canvas)
    # Рука со стороны наклона перекидывается через макушку: локоть выше головы.
    elbow = (-0.94, center[1] - 0.34)
    canvas.bone((-0.58, SHOULDER_Y), elbow, width=0.032)
    canvas.bone(elbow, hand, width=0.032)
    # Вторая рука зафиксирована под бедром — плечо не едет к уху.
    canvas.bone((0.58, SHOULDER_Y), (0.72, -0.34), width=0.03, color=MUTED)
    canvas.bone((0.48, -0.38), (0.96, -0.38), width=0.032, color=MUTED)
    canvas.arrow((0.90, SHOULDER_Y + 0.16), (0.90, SHOULDER_Y - 0.14))


def trap_stretch(canvas: Canvas, t: float) -> None:
    """NK6. Ухо к плечу, рука сверху добавляет наклон, второе плечо прижато вниз."""
    k = ease(t)
    tilt = lerp(0.0, 26.0, k)
    center = head_center(tilt)
    stretch_frame(canvas, center, (center[0] + HEAD_R_BIG * 0.55, center[1] + HEAD_R_BIG * 0.85))
    head_front(canvas, tilt)
    if k > 0.5:
        canvas.arrow((center[0] - 0.34, center[1] + 0.30), (center[0] - 0.14, center[1] + 0.20))


def levator_stretch(canvas: Canvas, t: float) -> None:
    """NK7. Нос к подмышке: тот же наклон плюс поворот головы."""
    k = ease(t)
    tilt = lerp(0.0, 24.0, k)
    center = head_center(tilt)
    stretch_frame(canvas, center, (center[0] + HEAD_R_BIG * 0.25, center[1] + HEAD_R_BIG * 0.95))
    head_front(canvas, tilt, turn=-0.5 * k)
    if k > 0.5:
        canvas.arrow((center[0] - 0.10, center[1] + 0.44), (center[0] - 0.24, center[1] + 0.22))


def spine(canvas: Canvas, a: Point, b: Point, curve: float, width: float = 0.042, color=INK) -> None:
    """Позвоночник дугой: провис в планке, круглая спина в кошке, прогиб в корове."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    normal = (-dy / length, dx / length)
    points: list[Point] = []
    for index in range(9):
        s = index / 8
        base = lerp_pt(a, b, s)
        bump = math.sin(math.pi * s) * curve
        points.append((base[0] + normal[0] * bump, base[1] + normal[1] * bump))
    for index in range(8):
        canvas.bone(points[index], points[index + 1], width=width, color=color)


def quadruped(
    canvas: Canvas,
    curve: float = 0.0,
    head_drop: float = 0.0,
    free_arm: Point | None = None,
    free_leg: Point | None = None,
) -> tuple[Point, Point]:
    """Четвереньки в профиль: кисти под плечами, колени под тазом."""
    shoulder = (0.30, 0.62)
    hip = (-0.32, 0.62)
    canvas.bone(shoulder, (0.34, 0.0), width=0.032)
    canvas.bone(hip, (-0.30, 0.20), width=0.032)
    canvas.bone((-0.30, 0.20), (-0.36, 0.0), width=0.03)
    canvas.bone((-0.36, 0.0), (-0.68, 0.0), width=0.028)
    if free_arm is not None:
        canvas.bone(shoulder, free_arm, width=0.03, color=MUTED)
    if free_leg is not None:
        canvas.bone(hip, free_leg, width=0.03, color=MUTED)
    spine(canvas, hip, shoulder, curve)
    # Голова уходит вперёд-вниз от плеча: без этого профиль читается как стол.
    head = (0.30 + HEAD_R * 1.9, 0.50 - head_drop)
    canvas.bone(shoulder, head, width=0.032)
    canvas.circle(head, HEAD_R * 1.15, fill=BG)
    return hip, shoulder


def supine_pose(hip: Point, shoulder: Point, wrist: Point, ankle: Point, **kwargs) -> Pose:
    """Лёжа на спине: стопа не рисуется, голова смотрит вверх."""
    kwargs.setdefault("foot", "none")
    return Pose(hip=hip, shoulder=shoulder, wrist=wrist, ankle=ankle, **kwargs)


# --- Упражнения -------------------------------------------------------------
# Каждое: функция t ∈ [0,1] → Pose (петля «туда и обратно») либо своя отрисовка.


def swing(t: float) -> Pose:
    """PC3. Удар тазом: снаряд проводится между ног, руки остаются прямыми."""
    k = ease(t)
    hip = (lerp(0.0, -0.20, k), lerp(0.82, 0.70, k))
    lean = lerp(88.0, 44.0, k)
    shoulder = polar(hip, lean, TORSO)
    wrist = straight_arm(shoulder, lerp(-2.0, -128.0, k))
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(0.0, 0.0),
        bell=0.085,
        head_lean=lerp(-4.0, 8.0, k),
        arrow=((hip[0] - 0.34, hip[1]), (hip[0] - 0.14, hip[1])) if k > 0.55 else None,
    )


def squat(t: float) -> Pose:
    """LG5. Таз вниз и назад, пятки на полу, спина прямая."""
    k = ease(t)
    hip = (lerp(0.0, -0.17, k), lerp(0.82, 0.44, k))
    shoulder = polar(hip, lerp(87.0, 62.0, k), TORSO)
    wrist = straight_arm(shoulder, lerp(-64.0, -8.0, k))
    return Pose(hip=hip, shoulder=shoulder, wrist=wrist, ankle=(0.0, 0.0))


def pushup(t: float) -> Pose:
    """PR3. Тело одной линией от пяток до головы, сгибаются только локти."""
    k = ease(t)
    shoulder_y = lerp(0.56, 0.26, k)
    shoulder = (0.60, shoulder_y)
    body = TORSO + THIGH + SHIN
    drop = min(shoulder_y - 0.08, body * 0.999)
    angle = 180.0 + math.degrees(math.asin(max(0.0, drop) / body))
    return Pose(
        hip=polar(shoulder, angle, TORSO),
        shoulder=shoulder,
        wrist=(0.62, 0.0),
        ankle=polar(shoulder, angle, body),
        foot="toes",
        arrow=((0.30, shoulder_y + 0.42), (0.30, shoulder_y + 0.16)) if k < 0.45 else None,
    )


def bent_row(t: float) -> Pose:
    """RW1. Опора на стул, спина параллельна полу, локоть идёт вдоль тела."""
    k = ease(t)
    hip = (-0.10, 0.78)
    shoulder = polar(hip, 34.0, TORSO)
    wrist = (shoulder[0] - lerp(0.02, 0.12, k), lerp(shoulder[1] - 0.62, shoulder[1] - 0.30, k))
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(-0.14, 0.0),
        bell=0.08,
        elbow_bend=-1.0,
        head_lean=-6.0,
        support=(shoulder[0] + 0.40, 0.62),
        prop=(shoulder[0] + 0.40, 0.62),
        arrow=((shoulder[0] + 0.22, shoulder[1] - 0.58), (shoulder[0] + 0.22, shoulder[1] - 0.30)),
    )


def single_leg_deadlift(t: float) -> Pose:
    """PC2. Свободная нога уходит назад в линию с корпусом, спина прямая."""
    k = ease(t)
    hip = (lerp(0.0, -0.14, k), lerp(0.80, 0.72, k))
    lean = lerp(86.0, 22.0, k)
    shoulder = polar(hip, lean, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0),
        ankle=(0.0, 0.0),
        bell=0.075,
        free_leg=polar(hip, lean - 180.0, (THIGH + SHIN) * 0.96),
        head_lean=lerp(-4.0, 2.0, k),
        guide=(shoulder, polar(hip, lean - 180.0, (THIGH + SHIN) * 0.96)) if k > 0.6 else None,
    )


def good_morning(t: float) -> Pose:
    """PC5. Наклон с прямой спиной, гиря у груди — база тазового шарнира."""
    k = ease(t)
    hip = (lerp(0.0, -0.16, k), lerp(0.82, 0.76, k))
    lean = lerp(88.0, 34.0, k)
    shoulder = polar(hip, lean, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=polar(shoulder, lean - 96.0, 0.20),
        ankle=(0.0, 0.0),
        bell=0.08,
        elbow_bend=-1.0,
    )


def romanian_deadlift(t: float) -> Pose:
    """PC1. Тот же наклон, но гири висят на прямых руках вдоль ног."""
    k = ease(t)
    hip = (lerp(0.0, -0.18, k), lerp(0.82, 0.74, k))
    lean = lerp(88.0, 30.0, k)
    shoulder = polar(hip, lean, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0),
        ankle=(0.0, 0.0),
        bell=0.08,
        guide=(shoulder, hip),
    )


def gorilla_row(t: float) -> Pose:
    """RW2. Наклон удерживается, тянет только рука."""
    k = ease(t)
    hip = (-0.14, 0.76)
    shoulder = polar(hip, 40.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(shoulder[0] - lerp(0.02, 0.12, k), lerp(shoulder[1] - 0.60, shoulder[1] - 0.28, k)),
        ankle=(-0.16, 0.0),
        bell=0.08,
        elbow_bend=-1.0,
        head_lean=-6.0,
    )


def backpack_row(t: float) -> Pose:
    """RW8. То же движение, но в руках рюкзак."""
    pose = gorilla_row(t)
    pose.bell = None
    return pose


def prone_row(t: float) -> Pose:
    """RW5. Лёжа на животе: тянут только руки, грудь остаётся на полу."""
    k = ease(t)
    shoulder = (0.28, 0.10)
    return Pose(
        hip=(-0.24, 0.10),
        shoulder=shoulder,
        wrist=(lerp(0.72, 0.30, k), lerp(0.06, 0.20, k)),
        ankle=(-0.24 - (THIGH + SHIN) * 0.98, 0.06),
        foot="none",
        bell=0.07,
        elbow_bend=-1.0,
        head_lean=-8.0,
    )


def with_bar(pose_fn: Callable[[float], Pose]) -> Draw:
    """Турник рисуется отдельно: без перекладины вис читается как парение."""

    def draw(canvas: Canvas, t: float) -> None:
        canvas.bar((0.02, 2.26), half_width=0.44)
        draw_figure(canvas, pose_fn(t))

    return draw


def pullup(t: float) -> Pose:
    """RW6. Локти к рёбрам, тело вертикально, вис полный."""
    k = ease(t)
    wrist = (0.34, 2.24)
    shoulder = (0.0, lerp(1.50, 1.86, k))
    hip = (0.0, shoulder[1] - TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(-0.10, hip[1] - (THIGH + SHIN) * 0.96),
        foot="none",
        elbow_bend=-1.0,
        head_lean=0.0,
    )


def bar_hang(t: float) -> Pose:
    """SC8. Свободный вис, потом плечи вниз от ушей."""
    k = ease(t)
    wrist = (0.30, 2.24)
    shoulder = (0.0, lerp(1.48, 1.58, k))
    hip = (0.0, shoulder[1] - TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(-0.06, hip[1] - (THIGH + SHIN) * 0.96),
        foot="none",
        elbow_bend=-1.0,
        arrow=((0.42, shoulder[1] + 0.24), (0.42, shoulder[1] + 0.02)) if k > 0.5 else None,
    )


def table_row(t: float) -> Pose:
    """RW7. Тело прямой линией, грудь идёт к краю стола."""
    k = ease(t)
    wrist = (0.52, 0.72)
    shoulder = (lerp(0.10, 0.30, k), lerp(0.40, 0.52, k))
    body = TORSO + THIGH + SHIN
    angle = 180.0 + math.degrees(math.asin(min(0.999, (shoulder[1] - 0.06) / body)))
    return Pose(
        hip=polar(shoulder, angle, TORSO),
        shoulder=shoulder,
        wrist=wrist,
        ankle=polar(shoulder, angle, body),
        elbow_bend=-1.0,
        prop=(0.52, 0.72),
        guide=(shoulder, polar(shoulder, angle, body)),
    )


def overhead_press(t: float) -> Pose:
    """PR1. Корпус как доска, гиря идёт вертикально вверх."""
    k = ease(t)
    hip = (0.0, 0.82)
    shoulder = polar(hip, 90.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(shoulder[0] + 0.04, lerp(shoulder[1] + 0.10, shoulder[1] + 0.60, k)),
        ankle=(0.0, 0.0),
        bell=0.08,
        elbow_bend=-1.0,
        guide=(hip, (hip[0], hip[1] + TORSO + 0.62)),
    )


def floor_press(t: float) -> Pose:
    """PR4. Локти под 45°, пол сам ограничивает амплитуду."""
    k = ease(t)
    shoulder = (0.30, 0.12)
    return Pose(
        hip=(-0.22, 0.10),
        shoulder=shoulder,
        wrist=(shoulder[0] + 0.06, lerp(shoulder[1] + 0.16, shoulder[1] + 0.56, k)),
        ankle=(-0.62, 0.06),
        knee_bend=-1.0,
        elbow_bend=-1.0,
        foot="none",
        bell=0.075,
    )


def pullover(t: float) -> Pose:
    """SC9. Прямые руки уходят за голову, поясница прижата."""
    k = ease(t)
    shoulder = (0.30, 0.12)
    return Pose(
        hip=(-0.22, 0.10),
        shoulder=shoulder,
        wrist=straight_arm(shoulder, lerp(88.0, 24.0, k)),
        ankle=(-0.62, 0.06),
        knee_bend=-1.0,
        foot="none",
        bell=0.075,
        guide=((-0.22, 0.10), (0.30, 0.12)),
    )


def y_raise(t: float) -> Pose:
    """PR6. Наклон 45°, прямые руки идут вперёд-вверх."""
    k = ease(t)
    hip = (-0.10, 0.78)
    shoulder = polar(hip, 46.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, lerp(-92.0, -34.0, k)),
        ankle=(-0.12, 0.0),
        bell=0.06,
        head_lean=-6.0,
    )


def reverse_fly(t: float) -> Pose:
    """SC10. Наклон 45°, руки расходятся в стороны — в профиль видно локоть назад."""
    k = ease(t)
    hip = (-0.10, 0.78)
    shoulder = polar(hip, 46.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, lerp(-92.0, -150.0, k), 0.92),
        ankle=(-0.12, 0.0),
        bell=0.06,
        head_lean=-6.0,
    )


def wall_slide(t: float) -> Pose:
    """SC4. Спина, затылок и предплечья у стены, руки скользят вверх."""
    k = ease(t)
    hip = (-0.02, 0.82)
    shoulder = (-0.02, hip[1] + TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(0.16, lerp(shoulder[1] + 0.16, shoulder[1] + 0.54, k)),
        ankle=(0.12, 0.0),
        elbow_bend=-1.0,
        guide=((-0.10, 0.0), (-0.10, 1.62)),
    )


def suitcase_carry(t: float) -> Pose:
    """CR3. Гиря в одной руке, корпус строго вертикально — плечо не проваливается."""
    swing_leg = math.sin(2 * math.pi * t)
    hip = (0.0, 0.80 - abs(swing_leg) * 0.02)
    shoulder = polar(hip, 90.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0, 0.92),
        ankle=(swing_leg * 0.22, max(0.0, swing_leg) * 0.10),
        free_leg=(-swing_leg * 0.22, max(0.0, -swing_leg) * 0.10),
        bell=0.085,
        guide=(shoulder, (shoulder[0], 0.0)),
    )


def walk(t: float) -> Pose:
    """MB9. Спокойный шаг, руки свободны."""
    swing_leg = math.sin(2 * math.pi * t)
    hip = (0.0, 0.80 - abs(swing_leg) * 0.02)
    shoulder = polar(hip, 90.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0 + swing_leg * 22.0, 0.9),
        ankle=(swing_leg * 0.24, max(0.0, swing_leg) * 0.10),
        free_leg=(-swing_leg * 0.24, max(0.0, -swing_leg) * 0.10),
    )


def plank(t: float) -> Pose:
    """CR1. Таз в линии тела: провис — это и есть главная ошибка."""
    k = ease(t)
    shoulder = (0.52, 0.30)
    body = TORSO + THIGH + SHIN
    ankle = polar(shoulder, 180.0 + math.degrees(math.asin(0.22 / body)), body)
    line_hip = lerp_pt(shoulder, ankle, TORSO / body)
    hip = (line_hip[0], line_hip[1] - k * 0.16)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(0.52, 0.0),
        ankle=ankle,
        foot="toes",
        guide=(shoulder, ankle),
        arrow=((hip[0], hip[1] - 0.22), (hip[0], hip[1] - 0.04)) if k > 0.5 else None,
    )


def back_lunge(t: float) -> Pose:
    """LG2. Шаг назад, переднее бедро до параллели, колено над стопой."""
    k = ease(t)
    hip = (0.0, lerp(0.82, 0.56, k))
    shoulder = polar(hip, 86.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=polar(shoulder, -70.0, 0.26),
        ankle=(0.10, 0.0),
        free_leg=(lerp(-0.10, -0.62, k), 0.0),
        elbow_bend=-1.0,
    )


def bulgarian_squat(t: float) -> Pose:
    """LG4. Задняя стопа на стуле, работа передней ноги."""
    k = ease(t)
    hip = (0.0, lerp(0.80, 0.54, k))
    shoulder = polar(hip, 82.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=polar(shoulder, -70.0, 0.26),
        ankle=(0.16, 0.0),
        free_leg=(-0.52, 0.46),
        prop=(-0.52, 0.46),
        elbow_bend=-1.0,
    )


def chair_squat(t: float) -> Pose:
    """LG6. Присед на одной ноге до касания стула, таз назад."""
    k = ease(t)
    hip = (lerp(0.0, -0.20, k), lerp(0.82, 0.50, k))
    shoulder = polar(hip, lerp(86.0, 66.0, k), TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -10.0),
        ankle=(0.0, 0.0),
        free_leg=(0.62, 0.16),
        prop=(-0.34, 0.46),
    )


def calf_raise(t: float) -> Pose:
    """LG7. Подъём на носок и медленный спуск."""
    k = ease(t)
    hip = (0.0, 0.82 + k * 0.10)
    shoulder = polar(hip, 90.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -80.0, 0.9),
        ankle=(0.0, k * 0.10),
        foot="toes" if k > 0.15 else "flat",
        free_leg=(-0.18, 0.30),
    )


def rack_carry(t: float) -> Pose:
    """CR7. Гиря на плече, корпус вертикально, шаг ровный."""
    pose = suitcase_carry(t)
    pose.wrist = (pose.shoulder[0] + 0.10, pose.shoulder[1] - 0.06)
    pose.elbow_bend = -1.0
    pose.bell = 0.075
    return pose


def farmer_carry(t: float) -> Pose:
    """CR4. Две гири, плечи опущены и раскрыты."""
    pose = suitcase_carry(t)
    pose.guide = None
    return pose


def glute_bridge(t: float) -> Pose:
    """PC8. Таз до линии колено-таз-плечо, толчок пяткой."""
    k = ease(t)
    shoulder = (0.34, 0.09)
    hip = (-0.08, lerp(0.10, 0.34, k))
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=(0.30, 0.04),
        ankle=(-0.52, 0.0),
        knee_bend=-1.0,
        foot="flat",
        free_leg=(-0.30, 0.62),
        guide=(shoulder, (-0.52, 0.0)) if k > 0.6 else None,
    )


def dead_bug(canvas: Canvas, t: float) -> None:
    """CR6. Противоположные рука и нога идут к полу, поясница прижата."""
    k = ease(t)
    hip = (-0.20, 0.10)
    shoulder = (0.36, 0.10)
    canvas.bone(hip, shoulder, width=0.05)
    head = (shoulder[0] + 0.22, 0.12)
    canvas.bone(shoulder, head, width=0.032)
    canvas.circle(head, HEAD_R * 1.15, fill=BG)
    # Поясница прижата — это и есть условие упражнения.
    canvas.bone((hip[0] - 0.06, 0.02), (shoulder[0], 0.02), width=0.014, color=ACCENT)
    # Согнутые под прямым углом рука и нога остаются на месте.
    canvas.bone(shoulder, (shoulder[0] + 0.04, 0.72), width=0.03, color=MUTED)
    canvas.bone(hip, (hip[0] + 0.04, 0.62), width=0.03, color=MUTED)
    canvas.bone((hip[0] + 0.04, 0.62), (hip[0] + 0.44, 0.62), width=0.03, color=MUTED)
    # Рабочая пара опускается к полу: рука за голову, противоположная нога вперёд.
    canvas.bone(shoulder, polar(shoulder, lerp(84.0, 152.0, k), 0.62), width=0.034)
    knee = (hip[0] + 0.04, lerp(0.62, 0.26, k))
    canvas.bone(hip, knee, width=0.034)
    canvas.bone(knee, (knee[0] + lerp(0.40, 0.62, k), lerp(0.62, 0.16, k)), width=0.032)


def superman(canvas: Canvas, t: float) -> None:
    """PC6. Руки, грудь и ноги отрываются одновременно, взгляд в пол."""
    k = ease(t)
    lift = k * 0.26
    hip = (-0.16, 0.10)
    shoulder = (0.34, 0.10 + lift * 0.35)
    canvas.bone(hip, shoulder, width=0.05)
    head = (shoulder[0] + 0.22, shoulder[1] + 0.04)
    canvas.bone(shoulder, head, width=0.032)
    canvas.circle(head, HEAD_R * 1.15, fill=BG)
    canvas.bone(shoulder, (1.02, shoulder[1] + lift), width=0.034)
    canvas.bone(hip, (-1.00, hip[1] + lift), width=0.036)
    if k > 0.45:
        canvas.arrow((1.02, shoulder[1] + lift - 0.30), (1.02, shoulder[1] + lift - 0.06))
        canvas.arrow((-1.00, hip[1] + lift - 0.30), (-1.00, hip[1] + lift - 0.06))


def backpack_deadlift(t: float) -> Pose:
    """PC9. Таз назад, спина прямая, подъём ногами и тазом одновременно."""
    k = ease(t)
    hip = (lerp(-0.04, -0.20, k), lerp(0.82, 0.52, k))
    shoulder = polar(hip, lerp(88.0, 52.0, k), TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=straight_arm(shoulder, -90.0),
        ankle=(0.0, 0.0),
        guide=(shoulder, hip),
    )


def hip_flexor_stretch(t: float) -> Pose:
    """MB7. Колено сзади на полу, таз подвёрнут, лёгкий ход вперёд."""
    k = ease(t)
    hip = (lerp(0.0, 0.08, k), 0.62)
    shoulder = polar(hip, 92.0, TORSO)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=polar(shoulder, -80.0, 0.30),
        ankle=(0.42, 0.0),
        free_leg=(-0.46, 0.0),
        knee_bend=1.0,
        elbow_bend=-1.0,
        arrow=((hip[0] - 0.36, hip[1] + 0.10), (hip[0] - 0.14, hip[1] + 0.10)) if k > 0.5 else None,
    )


# --- Виды, для которых профиль бесполезен -----------------------------------


def prone_arms(mode: str) -> Draw:
    """SC1–SC3. Вид сверху: буква Y, T или W и тень под руками, когда они отрываются."""

    def draw(canvas: Canvas, t: float) -> None:
        k = ease(t)
        lift = k * 0.05
        shoulders = 0.34
        hips = -0.34
        canvas.bone((0.0, hips), (0.0, shoulders), width=0.30, color=INK)
        canvas.circle((0.0, shoulders + 0.30), HEAD_R * 1.3, fill=BG)
        for side in (-1, 1):
            root = (side * 0.17, shoulders)
            if mode == "Y":
                hand = polar(root, 52.0 if side > 0 else 128.0, 0.62)
                joints = [root, hand]
            elif mode == "T":
                hand = (side * 0.78, shoulders)
                joints = [root, hand]
            else:
                elbow = (side * 0.40, shoulders - 0.16)
                hand = (side * 0.46, shoulders + 0.30)
                joints = [root, elbow, hand]
            for index in range(len(joints) - 1):
                shadow_a = (joints[index][0] + lift, joints[index][1] - lift)
                shadow_b = (joints[index + 1][0] + lift, joints[index + 1][1] - lift)
                canvas.bone(shadow_a, shadow_b, width=0.03, color=MUTED)
                canvas.bone(joints[index], joints[index + 1], width=0.032)
            canvas.bone((side * 0.12, hips), (side * 0.16, hips - 0.62), width=0.032)
        if k > 0.5:
            canvas.arrow((0.0, hips - 0.30), (0.0, hips - 0.10))

    return draw


def halo(canvas: Canvas, t: float) -> None:
    """SC6. Гиря идёт кругом вокруг головы, шея неподвижна."""
    shoulders(canvas)
    canvas.bone((0.0, SHOULDER_Y), (0.0, HEAD_Y - HEAD_R_BIG), width=0.055)
    canvas.circle((0.0, HEAD_Y), HEAD_R_BIG, fill=BG)
    angle = 90.0 - 360.0 * t
    canvas.kettlebell(polar((0.0, HEAD_Y), angle, HEAD_R_BIG + 0.22), 0.11)
    canvas.bone((-0.34, SHOULDER_Y), (-0.10, HEAD_Y - 0.10), width=0.03, color=MUTED)
    canvas.bone((0.34, SHOULDER_Y), (0.10, HEAD_Y - 0.10), width=0.03, color=MUTED)


def side_plank(canvas: Canvas, t: float) -> None:
    """CR2. Линия от стоп до головы, таз не проваливается."""
    k = ease(t)
    shoulder = (0.42, 0.46)
    ankle = (-0.62, 0.06)
    line_hip = lerp_pt(shoulder, ankle, 0.42)
    hip = (line_hip[0], line_hip[1] - k * 0.14)
    canvas.bone(shoulder, ankle, width=0.012, color=ACCENT)
    canvas.bone(shoulder, (0.42, 0.0), width=0.032)
    canvas.bone((0.42, 0.0), (0.26, 0.0), width=0.028)
    canvas.bone(hip, shoulder, width=0.042)
    canvas.bone(hip, ankle, width=0.038)
    canvas.bone((ankle[0] - 0.12, 0.0), (ankle[0] + 0.06, 0.06), width=0.028)
    canvas.bone(shoulder, (0.56, 0.60), width=0.03)
    canvas.circle((0.62, 0.66), HEAD_R, fill=BG)
    if k > 0.5:
        canvas.arrow((hip[0], hip[1] - 0.26), (hip[0], hip[1] - 0.06))


def get_up(canvas: Canvas, t: float) -> None:
    """CR5. Подъём по частям: рука с гирей всё время вертикально вверх."""
    k = ease(t)
    hip = (-0.10, lerp(0.10, 0.26, k))
    torso_angle = lerp(6.0, 62.0, k)
    shoulder = polar(hip, torso_angle, TORSO)
    wrist = (shoulder[0], shoulder[1] + UPPER_ARM + FOREARM)
    support = (shoulder[0] - 0.34, max(0.0, 0.30 - k * 0.30))
    canvas.bone(shoulder, support, width=0.03, color=MUTED)
    canvas.bone(hip, (0.34, 0.10), width=0.036)
    canvas.bone((0.34, 0.10), (0.30, 0.0), width=0.032)
    canvas.bone(hip, shoulder, width=0.042)
    canvas.bone(shoulder, wrist, width=0.034)
    head = polar(shoulder, torso_angle, NECK + HEAD_R)
    canvas.bone(shoulder, head, width=0.03)
    canvas.circle(head, HEAD_R, fill=BG)
    canvas.kettlebell(wrist, 0.08)
    canvas.bone((wrist[0] - 0.26, wrist[1] + 0.06), (wrist[0] - 0.06, wrist[1] + 0.06), 0.012, ACCENT)


def backpack_carry(canvas: Canvas, t: float) -> None:
    """CR8. Рюкзак сидит высоко на спине, корпус не заваливается вперёд."""
    pose = walk(t)
    draw_figure(canvas, pose)
    canvas.backpack((pose.shoulder[0] - 0.16, pose.shoulder[1] - 0.16))
    canvas.bone(pose.shoulder, (pose.shoulder[0], 0.0), width=0.012, color=ACCENT)


def towel_extension(canvas: Canvas, t: float) -> None:
    """MB1. Полотенце-валик под лопатками, прогиб идёт через грудной отдел."""
    k = ease(t)
    roll = (0.14, 0.13)
    canvas.roll(roll, radius=0.13)
    hip = (-0.38, 0.09)
    shoulder = (0.40, lerp(0.22, 0.34, k))
    canvas.bone(hip, (-0.60, 0.30), width=0.036)
    canvas.bone((-0.60, 0.30), (-0.78, 0.0), width=0.032)
    canvas.bone(hip, shoulder, width=0.042)
    head = (shoulder[0] + 0.20, shoulder[1] + lerp(0.10, -0.02, k))
    canvas.bone(shoulder, head, width=0.03)
    canvas.circle(head, HEAD_R, fill=BG)
    canvas.bone(shoulder, (shoulder[0] + 0.10, shoulder[1] + 0.24), width=0.028, color=MUTED)
    canvas.bone((-0.34, 0.02), (0.06, 0.02), width=0.012, color=ACCENT)
    if k > 0.5:
        canvas.arrow((shoulder[0] + 0.34, shoulder[1] + 0.30), (shoulder[0] + 0.16, shoulder[1] + 0.16))


def open_book(canvas: Canvas, t: float) -> None:
    """MB2. Вид сверху: колени стоят на месте, разворачивается только грудь."""
    k = ease(t)
    hip = (-0.42, 0.0)
    shoulder = (0.28, 0.0)
    canvas.circle((hip[0] - 0.10, -0.16), 0.13, color=MUTED)
    canvas.circle((hip[0] - 0.10, 0.16), 0.13, color=MUTED)
    canvas.bone((hip[0] - 0.10, 0.0), hip, width=0.034, color=MUTED)
    canvas.bone(hip, shoulder, width=0.05)
    canvas.circle((shoulder[0] + 0.28, 0.0), HEAD_R * 1.2, fill=BG)
    lower = polar(shoulder, -84.0, 0.62)
    canvas.bone(shoulder, lower, width=0.032, color=MUTED)
    upper = polar(shoulder, lerp(-84.0, 84.0, k), 0.62)
    canvas.bone(shoulder, upper, width=0.042)
    if k > 0.35:
        canvas.arrow(polar(shoulder, 20.0, 0.74), polar(shoulder, 74.0, 0.74))


def cat_cow(canvas: Canvas, t: float) -> None:
    """MB3. Кошка и корова: спина округляется и прогибается, шея работает вместе с ней."""
    k = ease(t)
    quadruped(canvas, curve=lerp(0.16, -0.14, k), head_drop=lerp(0.24, -0.10, k))


def bird_dog(canvas: Canvas, t: float) -> None:
    """PC7. Противоположные рука и нога в линию с корпусом, таз ровный."""
    k = ease(t)
    quadruped(canvas)
    hand = (0.30 + 0.66 * k, 0.62 + 0.30 * k)
    heel = (-0.32 - 0.68 * k, 0.62 + 0.26 * k)
    canvas.bone((0.30, 0.62), hand, width=0.032)
    canvas.bone((-0.32, 0.62), heel, width=0.032)
    if k > 0.6:
        canvas.bone(hand, heel, width=0.012, color=ACCENT)


def thread_needle(canvas: Canvas, t: float) -> None:
    """MB6. Рука продевается под корпусом, таз остаётся над коленями."""
    k = ease(t)
    quadruped(canvas, head_drop=0.34 * k, free_arm=(0.30 - 0.62 * k, 0.62 - 0.56 * k))
    if k > 0.5:
        canvas.arrow((0.10, 0.16), (-0.24, 0.10))


def doorway_stretch(canvas: Canvas, t: float) -> None:
    """MB4. Предплечье на косяке, шаг вперёд разворачивает корпус от руки."""
    k = ease(t)
    canvas.wall(0.52)
    hip = (lerp(-0.06, 0.06, k), 0.82)
    shoulder = polar(hip, 90.0, TORSO)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(0.50, shoulder[1] + 0.26),
            ankle=(hip[0], 0.0),
            elbow_bend=-1.0,
            free_leg=(hip[0] - 0.34, 0.0),
        ),
    )
    if k > 0.5:
        canvas.arrow((hip[0] - 0.40, hip[1] + 0.08), (hip[0] - 0.18, hip[1] + 0.08))


def ankle_stretch(canvas: Canvas, t: float) -> None:
    """MB8. Колено идёт к стене, пятка остаётся на полу."""
    k = ease(t)
    canvas.wall(0.62)
    hip = (lerp(-0.02, 0.06, k), 0.74)
    shoulder = polar(hip, 88.0, TORSO)
    ankle = (0.30, 0.0)
    draw_figure(
        canvas,
        Pose(
            hip=hip,
            shoulder=shoulder,
            wrist=(0.54, shoulder[1] - 0.10),
            ankle=ankle,
            free_leg=(hip[0] - 0.40, 0.0),
            elbow_bend=-1.0,
        ),
    )
    knee = ik(hip, ankle, THIGH, SHIN, 1.0)
    canvas.arrow((knee[0] + 0.10, knee[1]), (min(0.58, knee[0] + 0.30), knee[1]))


def worlds_greatest(canvas: Canvas, t: float) -> None:
    """MB5. Выпад, локоть к полу, потом раскрытие корпуса с рукой вверх."""
    k = ease(t)
    hip = (-0.06, 0.48)
    shoulder = polar(hip, 74.0, TORSO)
    canvas.bone(hip, (0.34, 0.44), width=0.038)
    canvas.bone((0.34, 0.44), (0.34, 0.0), width=0.034)
    canvas.bone((0.22, 0.0), (0.48, 0.0), width=0.028)
    canvas.bone(hip, (-0.52, 0.16), width=0.034, color=MUTED)
    canvas.bone((-0.52, 0.16), (-0.82, 0.0), width=0.03, color=MUTED)
    canvas.bone(hip, shoulder, width=0.042)
    canvas.bone(shoulder, (0.12, 0.0), width=0.03, color=MUTED)
    up = polar(shoulder, lerp(-70.0, 76.0, k), UPPER_ARM + FOREARM)
    canvas.bone(shoulder, up, width=0.032)
    head = polar(shoulder, 74.0, NECK + HEAD_R)
    canvas.bone(shoulder, head, width=0.03)
    canvas.circle(head, HEAD_R, fill=BG)
    if k > 0.4:
        canvas.arrow(polar(shoulder, 10.0, 0.74), polar(shoulder, 62.0, 0.74))


def external_rotation(canvas: Canvas, t: float) -> None:
    """PR5. Локоть прижат к рёбрам, доворачивается только предплечье."""
    k = ease(t)
    hip = (-0.46, 0.18)
    shoulder = (0.26, 0.20)
    canvas.bone((-0.86, 0.14), hip, width=0.036)
    canvas.bone(hip, shoulder, width=0.042)
    head = (0.52, 0.24)
    canvas.bone(shoulder, head, width=0.03)
    canvas.circle(head, HEAD_R, fill=BG)
    elbow = (0.10, 0.12)
    canvas.bone(shoulder, elbow, width=0.032)
    wrist = polar(elbow, lerp(-6.0, 84.0, k), FOREARM)
    canvas.bone(elbow, wrist, width=0.032)
    canvas.kettlebell(wrist, 0.06)
    canvas.circle(elbow, 0.05, color=ACCENT)


def supine_head_lift(canvas: Canvas, t: float) -> None:
    """NK8. Сначала подбородок назад, потом голова отрывается на пару сантиметров."""
    k = ease(t)
    canvas.bone((-0.82, 0.10), (0.10, 0.10), width=0.12)
    head = (0.42, lerp(0.12, 0.30, k))
    canvas.bone((0.10, 0.10), (head[0] - HEAD_R * 0.9, head[1]), width=0.05)
    canvas.circle(head, HEAD_R * 1.3, fill=BG)
    canvas.bone((head[0] - 0.02, head[1] + HEAD_R * 1.3), (head[0] - 0.10, head[1] + HEAD_R * 1.6), 0.03)
    canvas.bone((-0.82, 0.02), (0.60, 0.02), width=0.012, color=ACCENT)
    if k > 0.4:
        canvas.arrow((head[0] + 0.32, head[1] - 0.10), (head[0] + 0.32, head[1] + 0.14))


def prone_head_lift(canvas: Canvas, t: float) -> None:
    """NK9. Лоб на кулаках, взгляд остаётся в пол."""
    k = ease(t)
    canvas.bone((-0.82, 0.12), (0.10, 0.12), width=0.12)
    head = (0.44, lerp(0.14, 0.26, k))
    canvas.bone((0.10, 0.12), (head[0] - HEAD_R * 0.9, head[1]), width=0.05)
    canvas.circle(head, HEAD_R * 1.3, fill=BG)
    canvas.circle((head[0] + 0.06, head[1] - HEAD_R * 1.5), 0.09, color=INK)
    canvas.bone((head[0] + HEAD_R * 1.1, head[1] - 0.06), (head[0] + HEAD_R * 1.7, head[1] - 0.12), 0.03)
    if k > 0.4:
        canvas.arrow((head[0] + 0.30, head[1] - 0.14), (head[0] + 0.30, head[1] + 0.10))


def breathing_90_90(canvas: Canvas, t: float) -> None:
    """NK10. Голени на стуле, поясница прижата, дышат нижние рёбра."""
    breath = 0.5 - 0.5 * math.cos(2 * math.pi * t)
    canvas.chair((0.42, 0.44), half_width=0.26)
    canvas.bone((-0.80, 0.10), (0.06, 0.10), width=0.10)
    canvas.bone((0.06, 0.10), (0.10, 0.44), width=0.038)
    canvas.bone((0.10, 0.44), (0.60, 0.44), width=0.034)
    head = (-1.02, 0.20)
    canvas.bone((-0.80, 0.12), (head[0] + HEAD_R * 0.9, head[1]), width=0.045)
    canvas.circle(head, HEAD_R * 1.2, fill=BG)
    # Нижние рёбра расходятся на вдохе и уходят вниз на выдохе.
    canvas.circle((-0.40, 0.16), 0.13 + breath * 0.07, color=ACCENT)
    canvas.bone((-0.80, 0.02), (0.10, 0.02), width=0.012, color=ACCENT)


# --- Реестр -----------------------------------------------------------------

STAND = Camera()
LYING = Camera(origin_x=0.5, origin_y=0.62, zoom=0.85, ground=False)
HEAD = Camera(origin_x=0.5, origin_y=0.8, zoom=0.62, ground=False)
TOPDOWN = Camera(origin_x=0.5, origin_y=0.62, zoom=0.62, ground=False)


@dataclass
class Demo:
    title: str
    draw: Draw
    camera: Camera = field(default_factory=Camera)


DEMOS: dict[str, Demo] = {
    # Шея
    "NK1": Demo("Подбородок назад", chin_tuck, HEAD),
    "NK2": Demo("Изометрия: сгибание", neck_press_front, HEAD),
    "NK3": Demo("Изометрия: разгибание", neck_press_back, HEAD),
    "NK4": Demo("Изометрия: вбок", neck_press_side, HEAD),
    "NK5": Demo("Изометрия: ротация", neck_press_rotation, HEAD),
    "NK6": Demo("Растяжка трапеции", trap_stretch, HEAD),
    "NK7": Demo("Растяжка леватора", levator_stretch, HEAD),
    "NK8": Demo("Подъём головы лёжа", supine_head_lift, LYING),
    "NK9": Demo("Разгибатели лёжа", prone_head_lift, LYING),
    "NK10": Demo("Дыхание 90/90", breathing_90_90, Camera(origin_x=0.66, origin_y=0.72, zoom=0.86, ground=False)),
    # Лопатки
    "SC1": Demo("Prone Y", prone_arms("Y"), TOPDOWN),
    "SC2": Demo("Prone T", prone_arms("T"), TOPDOWN),
    "SC3": Demo("Prone W", prone_arms("W"), TOPDOWN),
    "SC4": Demo("Скольжение по стене", figure(wall_slide), Camera(origin_x=0.5, zoom=0.86)),
    "SC6": Demo("Halo с гирей", halo, HEAD),
    "SC8": Demo("Вис на турнике", with_bar(bar_hang), Camera(origin_x=0.5, origin_y=0.94, zoom=0.68, ground=False)),
    "SC9": Demo("Пуловер лёжа", figure(pullover), LYING),
    "SC10": Demo("Обратная «муха»", figure(reverse_fly), Camera(origin_x=0.5, zoom=0.9)),
    # Тяги
    "RW1": Demo("Тяга одной рукой", figure(bent_row), Camera(origin_x=0.34, origin_y=0.9, zoom=0.92)),
    "RW2": Demo("Тяга двумя гирями", figure(gorilla_row), Camera(origin_x=0.4, zoom=0.92)),
    "RW5": Demo("Тяга лёжа на животе", figure(prone_row), LYING),
    "RW6": Demo("Подтягивания", with_bar(pullup), Camera(origin_x=0.5, origin_y=0.94, zoom=0.68, ground=False)),
    "RW7": Demo("Тяга под столом", figure(table_row), Camera(origin_x=0.34, origin_y=0.86, zoom=0.8)),
    "RW8": Demo("Тяга рюкзака", figure(backpack_row), Camera(origin_x=0.4, zoom=0.92)),
    # Задняя цепь
    "PC1": Demo("Румынская тяга", figure(romanian_deadlift), Camera(origin_x=0.46)),
    "PC2": Demo("Румынская на одной ноге", figure(single_leg_deadlift), Camera(origin_x=0.5, zoom=0.9)),
    "PC3": Demo("Свинг двумя руками", figure(swing), STAND),
    "PC4": Demo("Свинг одной рукой", figure(swing), STAND),
    "PC5": Demo("Good morning", figure(good_morning), Camera(origin_x=0.44)),
    "PC6": Demo("Superman", superman, LYING),
    "PC7": Demo("Bird dog", bird_dog, Camera(origin_x=0.5, origin_y=0.82, zoom=0.8)),
    "PC8": Demo("Ягодичный мостик", figure(glute_bridge), LYING),
    "PC9": Demo("Становая с рюкзаком", figure(backpack_deadlift), Camera(origin_x=0.46)),
    # Жимы и ротаторы
    "PR1": Demo("Жим стоя", figure(overhead_press), Camera(origin_x=0.44, zoom=0.86)),
    "PR3": Demo("Отжимания", figure(pushup), Camera(origin_x=0.44, origin_y=0.72, zoom=1.12)),
    "PR4": Demo("Жим лёжа на полу", figure(floor_press), LYING),
    "PR5": Demo("Внешняя ротация", external_rotation, LYING),
    "PR6": Demo("Y-raise в наклоне", figure(y_raise), Camera(origin_x=0.4, zoom=0.9)),
    # Ноги
    "LG2": Demo("Выпад назад", figure(back_lunge), Camera(origin_x=0.56, zoom=0.9)),
    "LG4": Demo("Болгарский присед", figure(bulgarian_squat), Camera(origin_x=0.56, zoom=0.88)),
    "LG5": Demo("Присед", figure(squat), STAND),
    "LG6": Demo("Присед к стулу", figure(chair_squat), Camera(origin_x=0.44, zoom=0.88)),
    "LG7": Demo("Подъём на носок", figure(calf_raise), Camera(origin_x=0.5, zoom=0.9)),
    # Корпус
    "CR1": Demo("Планка", figure(plank), Camera(origin_x=0.46, origin_y=0.74, zoom=1.12)),
    "CR2": Demo("Боковая планка", side_plank, Camera(origin_x=0.5, origin_y=0.8, zoom=0.9)),
    "CR3": Demo("Чемоданная переноска", figure(suitcase_carry), STAND),
    "CR4": Demo("Фермерская переноска", figure(farmer_carry), STAND),
    "CR5": Demo("Turkish get-up", get_up, Camera(origin_x=0.5, origin_y=0.86, zoom=0.78)),
    "CR6": Demo("Dead bug", dead_bug, LYING),
    "CR7": Demo("Rack carry", figure(rack_carry), STAND),
    "CR8": Demo("Переноска рюкзака", backpack_carry, STAND),
    # Мобильность
    "MB1": Demo("Грудной отдел на полотенце", towel_extension, LYING),
    "MB2": Demo("Open book", open_book, TOPDOWN),
    "MB3": Demo("Cat-cow", cat_cow, Camera(origin_x=0.5, origin_y=0.82, zoom=0.8)),
    "MB4": Demo("Растяжка груди в проёме", doorway_stretch, Camera(origin_x=0.42, zoom=0.88)),
    "MB5": Demo("World's greatest stretch", worlds_greatest, Camera(origin_x=0.5, origin_y=0.84, zoom=0.8)),
    "MB6": Demo("Thread the needle", thread_needle, Camera(origin_x=0.56, origin_y=0.82, zoom=0.8)),
    "MB7": Demo("Растяжка сгибателей бедра", figure(hip_flexor_stretch), Camera(origin_x=0.46, zoom=0.86)),
    "MB8": Demo("Растяжка голеностопа", ankle_stretch, Camera(origin_x=0.4, zoom=0.86)),
    "MB9": Demo("Прогулка", figure(walk), STAND),
}


def render(code: str, demo: Demo) -> str:
    frames: list[Image.Image] = []
    for index in range(FRAMES):
        canvas = Canvas(demo.camera)
        if demo.camera.ground:
            canvas.ground()
        canvas.label(demo.title)
        demo.draw(canvas, index / FRAMES)
        frames.append(canvas.finish().quantize(colors=PALETTE_COLORS, method=Image.MEDIANCUT))

    # Почти неподвижная схема — это не только скучно: Telegram не умеет собрать из неё
    # видео и возвращает файл документом вместо animation, а карточка ждёт анимацию.
    # Петля идёт туда-обратно, поэтому половина кадров — зеркала: различных всегда
    # примерно FRAMES/2 + 1, и порог стоит заметно ниже этого числа.
    unique = len({frame.tobytes() for frame in frames})
    if unique < MIN_UNIQUE_FRAMES:
        raise SystemExit(
            f"{code}: движения почти нет — {unique} различных кадров из {FRAMES}. "
            f"Увеличь амплитуду в схеме."
        )

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{code}.gif")
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
    """Список демонстраций для сборки воркера: гифки уезжают в бандл как бинарные модули."""
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
