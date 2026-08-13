#!/usr/bin/env python3
"""Рисованные демонстрации упражнений: схематичная фигура, зацикленная анимация.

Не видео с человеком, а подсказка «куда двигаться»: линия спины, траектория снаряда,
что сгибается, а что остаётся неподвижным. Своих медиа мы не хостим (ADR-014) — эти
гифки лежат в репозитории и уходят в сборку воркера.

Запуск: python3 scripts/build_demos.py  → assets/demos/<КОД>.gif
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = "assets/demos"

# Рисуем с четырёхкратным запасом и уменьшаем: у Pillow нет сглаживания линий.
SUPERSAMPLE = 4
SIZE = 320
FRAMES = 24
FRAME_MS = 60
# Схема обходится десятком цветов; палитра пожиже — файл втрое легче.
PALETTE_COLORS = 12

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
    phase = 0.5 - 0.5 * math.cos(2 * math.pi * t)
    return phase


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
    # Вторая точка опоры (рука на стуле) — рисуется приглушённо.
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


@dataclass
class Camera:
    """Кадрирование: у стоячих и лежачих упражнений оно разное."""

    origin_x: float = 0.42
    origin_y: float = 0.88
    zoom: float = 1.0


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

    def label(self, text: str) -> None:
        font = None
        for path in FONT_CANDIDATES:
            try:
                font = ImageFont.truetype(path, int(self.px * 0.045))
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

    if pose.support is not None:
        canvas.bone(pose.shoulder, pose.support, width=0.03, color=MUTED)

    if pose.prop is not None:
        canvas.bone(
            (pose.prop[0] - 0.16, pose.prop[1]),
            (pose.prop[0] + 0.16, pose.prop[1]),
            width=0.025,
            color=MUTED,
        )
        canvas.bone((pose.prop[0] + 0.12, pose.prop[1]), (pose.prop[0] + 0.12, 0.0), 0.02, MUTED)
        canvas.bone((pose.prop[0] - 0.12, pose.prop[1]), (pose.prop[0] - 0.12, 0.0), 0.02, MUTED)

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

    if pose.arrow is not None:
        canvas.arrow(pose.arrow[0], pose.arrow[1])


# --- Упражнения -------------------------------------------------------------
# Каждое: функция t ∈ [0,1] → Pose. t идёт по петле «туда и обратно».


def swing(t: float) -> Pose:
    """PC3. Удар тазом: снаряд проводится между ног, руки остаются прямыми."""
    k = ease(t)
    hip = (lerp(0.0, -0.20, k), lerp(0.82, 0.70, k))
    lean = lerp(88.0, 44.0, k)
    shoulder = polar(hip, lean, TORSO)
    # Вверху руки горизонтально вперёд, внизу уходят назад между ног.
    wrist = straight_arm(shoulder, lerp(-2.0, -128.0, k))
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(0.0, 0.0),
        bell=0.085,
        head_lean=lerp(-4.0, 8.0, k),
        knee_bend=1.0,
        elbow_bend=1.0,
        arrow=((hip[0] - 0.34, hip[1]), (hip[0] - 0.14, hip[1])) if k > 0.55 else None,
    )


def squat(t: float) -> Pose:
    """LG5. Таз вниз и назад, пятки на полу, спина прямая."""
    k = ease(t)
    hip = (lerp(0.0, -0.17, k), lerp(0.82, 0.44, k))
    lean = lerp(87.0, 62.0, k)
    shoulder = polar(hip, lean, TORSO)
    # Руки вперёд как противовес — прямые, иначе на схеме это читается как ломаная.
    wrist = straight_arm(shoulder, lerp(-64.0, -8.0, k))
    return Pose(hip=hip, shoulder=shoulder, wrist=wrist, ankle=(0.0, 0.0), elbow_bend=1.0)


def pushup(t: float) -> Pose:
    """PR3. Тело одной линией от пяток до головы, сгибаются только локти."""
    k = ease(t)
    wrist = (0.62, 0.0)
    shoulder_y = lerp(0.56, 0.26, k)
    shoulder = (0.60, shoulder_y)
    body = TORSO + THIGH + SHIN
    drop = min(shoulder_y - 0.08, body * 0.999)
    angle = 180.0 + math.degrees(math.asin(max(0.0, drop) / body))
    hip = polar(shoulder, angle, TORSO)
    ankle = polar(shoulder, angle, body)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=ankle,
        head_lean=0.0,
        knee_bend=1.0,
        elbow_bend=1.0,
        foot="toes",
        arrow=((0.30, shoulder_y + 0.42), (0.30, shoulder_y + 0.16)) if k < 0.45 else None,
    )


def bent_row(t: float) -> Pose:
    """RW1. Опора на стул, спина параллельна полу, локоть идёт вдоль тела."""
    k = ease(t)
    hip = (-0.10, 0.78)
    shoulder = polar(hip, 34.0, TORSO)
    # Гиря идёт вертикально: внизу под плечом, вверху к поясу.
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
    wrist = straight_arm(shoulder, -90.0)
    # Нога — продолжение линии корпуса: таз не заваливается.
    free = polar(hip, lean - 180.0, (THIGH + SHIN) * 0.96)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(0.0, 0.0),
        bell=0.075,
        free_leg=free,
        head_lean=lerp(-4.0, 2.0, k),
        elbow_bend=1.0,
        guide=(shoulder, free) if k > 0.6 else None,
    )


def good_morning(t: float) -> Pose:
    """PC5. Наклон с прямой спиной, гиря у груди — база тазового шарнира."""
    k = ease(t)
    hip = (lerp(0.0, -0.16, k), lerp(0.82, 0.76, k))
    lean = lerp(88.0, 34.0, k)
    shoulder = polar(hip, lean, TORSO)
    wrist = polar(shoulder, lean - 96.0, 0.20)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=(0.0, 0.0),
        bell=0.08,
        elbow_bend=-1.0,
    )


def suitcase_carry(t: float) -> Pose:
    """CR3. Гиря в одной руке, корпус строго вертикально — плечо не проваливается."""
    k = ease(t)
    swing_leg = math.sin(2 * math.pi * t)
    hip = (0.0, 0.80 - abs(swing_leg) * 0.02)
    shoulder = polar(hip, 90.0, TORSO)
    wrist = straight_arm(shoulder, -90.0, 0.92)
    ankle = (swing_leg * 0.22, max(0.0, swing_leg) * 0.10)
    free = (-swing_leg * 0.22, max(0.0, -swing_leg) * 0.10)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=wrist,
        ankle=ankle,
        free_leg=free,
        bell=0.085,
        elbow_bend=1.0,
        guide=(shoulder, (shoulder[0], 0.0)),
    )


def plank(t: float) -> Pose:
    """CR1. Таз в линии тела: провис — это и есть главная ошибка."""
    k = ease(t)
    elbow = (0.52, 0.0)
    shoulder = (0.52, 0.30)
    body = TORSO + THIGH + SHIN
    ankle = polar(shoulder, 180.0 + math.degrees(math.asin(0.22 / body)), body)
    line_hip = lerp_pt(shoulder, ankle, TORSO / body)
    # Первая половина петли — правильная линия, вторая — показанный провис.
    hip = (line_hip[0], line_hip[1] - k * 0.16)
    return Pose(
        hip=hip,
        shoulder=shoulder,
        wrist=elbow,
        ankle=ankle,
        foot="toes",
        elbow_bend=1.0,
        guide=(shoulder, ankle),
        arrow=((hip[0], hip[1] - 0.22), (hip[0], hip[1] - 0.04)) if k > 0.5 else None,
    )


def draw_chin_tuck(canvas: Canvas, t: float) -> None:
    """NK1. Голова уезжает назад над плечом, подбородок скользит к горлу."""
    k = ease(t)
    shoulder = (0.0, 0.0)
    head_x = lerp(0.62, 0.06, k)
    head_y = 1.05
    head_r = 0.30

    # Ориентир: ухо должно оказаться над плечом.
    canvas.bone((0.0, 0.05), (0.0, head_y + head_r), width=0.012, color=ACCENT)
    canvas.bone((-0.55, 0.0), (0.45, 0.0), width=0.06)

    neck_base = (head_x * 0.35, 0.42)
    canvas.bone(shoulder, neck_base, width=0.055)
    canvas.bone(neck_base, (head_x, head_y - head_r), width=0.055)
    canvas.circle((head_x, head_y), head_r, fill=BG)
    # Нос: взгляд остаётся горизонтальным, голова не задирается.
    canvas.bone((head_x + head_r * 0.7, head_y), (head_x + head_r * 1.5, head_y - 0.02), width=0.04)
    # Подбородок: короткая черта, которая уезжает к горлу вместе с головой.
    canvas.bone(
        (head_x + head_r * 0.45, head_y - head_r * 0.75),
        (head_x + head_r * 1.05, head_y - head_r * 0.62),
        width=0.03,
        color=MUTED,
    )
    canvas.arrow((head_x + 0.5, head_y + 0.45), (head_x + 0.06, head_y + 0.45))


EXERCISES: dict[str, tuple[str, callable, Camera]] = {
    "PC3": ("Свинг двумя руками", swing, Camera()),
    "LG5": ("Присед с весом тела", squat, Camera()),
    "PR3": ("Отжимания", pushup, Camera(origin_x=0.44, origin_y=0.72, zoom=1.12)),
    "RW1": ("Тяга одной рукой", bent_row, Camera(origin_x=0.34, origin_y=0.9, zoom=0.92)),
    "PC2": ("Румынская на одной ноге", single_leg_deadlift, Camera(origin_x=0.5, zoom=0.9)),
    "PC5": ("Good morning с гирей", good_morning, Camera(origin_x=0.44)),
    "CR3": ("Чемоданная переноска", suitcase_carry, Camera()),
    "CR1": ("Планка", plank, Camera(origin_x=0.46, origin_y=0.74, zoom=1.12)),
    "NK1": ("Chin tuck", draw_chin_tuck, Camera(origin_x=0.36, origin_y=0.88, zoom=1.1)),
}


def render(code: str, title: str, pose_fn, camera: Camera | None = None) -> str:
    frames: list[Image.Image] = []
    for index in range(FRAMES):
        t = index / FRAMES
        canvas = Canvas(camera)
        if code != "NK1":
            canvas.ground()
        canvas.label(title)
        if code == "NK1":
            pose_fn(canvas, t)
        else:
            draw_figure(canvas, pose_fn(t))
        frames.append(canvas.finish().quantize(colors=PALETTE_COLORS, method=Image.MEDIANCUT))

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
    for code, (title, fn, camera) in EXERCISES.items():
        path = render(code, title, fn, camera)
        size = os.path.getsize(path)
        total += size
        print(f"{path}  {title}  {size // 1024} КБ")
    write_module(list(EXERCISES))
    print(f"{MODULE}: {len(EXERCISES)} схем, {total // 1024} КБ суммарно")


if __name__ == "__main__":
    main()
