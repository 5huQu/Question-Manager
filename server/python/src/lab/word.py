from __future__ import annotations

import zipfile
from pathlib import Path
from xml.etree import ElementTree


def analyze_docx_formula_types(path: Path) -> dict:
    """Classify formula storage in a docx without invoking OCR."""
    if path.suffix.lower() != ".docx":
        return {
            "file_type": path.suffix.lower().lstrip(".") or "unknown",
            "supported": False,
            "recommendation": "当前仅支持 .docx 结构检测；.doc 请先另存为 .docx 或转 PDF。",
            "counts": {},
        }

    counts = {
        "omml_formula_nodes": 0,
        "drawing_nodes": 0,
        "picture_nodes": 0,
        "ole_objects": 0,
        "media_files": 0,
    }

    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        counts["media_files"] = len([name for name in names if name.startswith("word/media/")])
        xml_names = [name for name in names if name.startswith("word/") and name.endswith(".xml")]
        for name in xml_names:
            data = archive.read(name)
            try:
                root = ElementTree.fromstring(data)
            except ElementTree.ParseError:
                continue
            for elem in root.iter():
                tag = elem.tag
                if tag.endswith("}oMath") or tag.endswith("}oMathPara"):
                    counts["omml_formula_nodes"] += 1
                elif tag.endswith("}drawing"):
                    counts["drawing_nodes"] += 1
                elif tag.endswith("}pict"):
                    counts["picture_nodes"] += 1
                elif tag.endswith("}OLEObject"):
                    counts["ole_objects"] += 1

    editable = counts["omml_formula_nodes"]
    image_like = counts["media_files"] + counts["picture_nodes"] + counts["ole_objects"]
    if editable and editable >= image_like:
        classification = "editable_formula"
        recommendation = "检测到较多 Word 可编辑公式节点，后续可优先尝试提取文本/公式结构或使用支持文件输入的模型。"
    elif image_like:
        classification = "image_or_ole_formula"
        recommendation = "检测到图片或 OLE 公式迹象，建议先转 PDF 或图片后走视觉 OCR。"
    elif editable:
        classification = "mixed_formula"
        recommendation = "检测到可编辑公式，但也可能混有图片内容；建议抽样检查后决定是否直送模型。"
    else:
        classification = "no_formula_detected"
        recommendation = "未检测到明显公式节点；如果文档仍含数学内容，建议人工抽样确认。"

    return {
        "file_type": "docx",
        "supported": True,
        "classification": classification,
        "counts": counts,
        "recommendation": recommendation,
    }
