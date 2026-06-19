from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

BBox = tuple[float, float, float, float]

DocumentType = Literal["answer_like", "exam_like", "worksheet_like", "unknown"]
AnchorKind = Literal["arabic", "section_question", "example"]
ConfidenceLevel = Literal["high", "medium", "low"]


@dataclass
class TextLine:
    text: str
    bbox: BBox
    block_index: int
    line_index: int
    font_sizes: list[float] = field(default_factory=list)


@dataclass
class TextBlock:
    index: int
    bbox: BBox
    text: str
    lines: list[TextLine]


@dataclass
class GraphicCluster:
    bbox: BBox
    source_count: int
    kinds: list[str]


@dataclass
class PageData:
    number: int
    width: float
    height: float
    body_bbox: BBox
    text_blocks: list[TextBlock]
    text_lines: list[TextLine]
    image_boxes: list[BBox]
    drawing_boxes: list[BBox]
    graphic_clusters: list[GraphicCluster]
    block_density: int
    has_text: bool


@dataclass
class DocumentData:
    source_pdf: str
    file_name: str
    document_type: DocumentType
    page_count: int
    pages: list[PageData]
    notes: list[str] = field(default_factory=list)


@dataclass
class QuestionAnchor:
    question_id: str
    display_label: str
    page_number: int
    bbox: BBox
    raw_text: str
    anchor_kind: AnchorKind
    section_title: str | None
    in_valid_section: bool
    score_hints: list[str] = field(default_factory=list)


@dataclass
class SliceSegment:
    page_number: int
    bbox: BBox


@dataclass
class Confidence:
    score: float
    level: ConfidenceLevel
    reasons: list[str]
    heading_match: float = 0.0
    boundary_stability: float = 0.0
    image_linking: float = 0.0
    flags: list[str] = field(default_factory=list)


@dataclass
class QuestionSlice:
    source_pdf: str
    page_number: int
    question_id: str
    question_label: str
    bbox: BBox
    page_span: list[int]
    segments: list[SliceSegment]
    confidence: Confidence
    has_possible_figure: bool
    notes: list[str]
    image_path: str
    document_type: DocumentType
    section_title: str | None = None
    text_excerpt: str = ""
    answer_summary: str | None = None
    flags: list[str] = field(default_factory=list)
    figures: list[dict] = field(default_factory=list)
    text_regions: list[dict] = field(default_factory=list)


@dataclass
class CutResult:
    id: str
    source_pdf: str
    page: int
    question_no: str | None
    auto_image_path: str
    page_image_path: str
    bbox: dict | None
    page_span: list[int] = field(default_factory=lambda: [1, 1])
    segments: list[dict] = field(default_factory=list)
    status: str = "pending_review"
    review_flags: list[str] = field(default_factory=list)
    note: str = ""
    figures: list[dict] = field(default_factory=list)
    text_regions: list[dict] = field(default_factory=list)
