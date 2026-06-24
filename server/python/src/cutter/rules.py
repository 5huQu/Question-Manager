from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

MATCH_CONTAINS = "contains"
MATCH_EXACT = "exact"
MATCH_MODES = (MATCH_CONTAINS, MATCH_EXACT)

_DEFAULT_RULES_JSON: dict = {
    "auxiliaryMarkers": [
        {"id": "aux_mulu", "term": "目录", "matchMode": "contains", "enabled": True},
        {"id": "aux_jietiguilv", "term": "解题规律", "matchMode": "contains", "enabled": True},
        {"id": "aux_tifenkuaizhao", "term": "提分快招", "matchMode": "contains", "enabled": True},
        {"id": "aux_tixingguina", "term": "题型归纳", "matchMode": "contains", "enabled": True},
        {"id": "aux_tixingtanxi", "term": "题型探析", "matchMode": "contains", "enabled": True},
        {"id": "aux_siweidaotu", "term": "思维导图", "matchMode": "contains", "enabled": True},
        {"id": "aux_zhishidian", "term": "知识点", "matchMode": "contains", "enabled": True},
        {"id": "aux_guilvfangfa", "term": "规律方法", "matchMode": "contains", "enabled": True},
        {"id": "aux_fangfajiqiao", "term": "方法技巧", "matchMode": "contains", "enabled": True},
    ],
    "noticeTerms": [
        {"id": "notice_dati", "term": "答题", "matchMode": "contains", "enabled": True},
        {"id": "notice_zhuyishixiang", "term": "注意事项", "matchMode": "contains", "enabled": True},
        {"id": "notice_zuoda", "term": "作答", "matchMode": "contains", "enabled": True},
        {"id": "notice_kaoshijieshu", "term": "考试结束", "matchMode": "contains", "enabled": True},
        {"id": "notice_dajuanqian", "term": "答卷前", "matchMode": "contains", "enabled": True},
        {"id": "notice_dabunengda", "term": "答案不能答在试卷上", "matchMode": "contains", "enabled": True},
    ],
    "referenceFormulaMarkers": [
        {"id": "ref_cankaogongshi", "term": "参考公式", "matchMode": "contains", "enabled": True},
        {"id": "ref_cankaoguanxishi", "term": "参考关系式", "matchMode": "contains", "enabled": True},
        {"id": "ref_cankaoshuju", "term": "参考数据", "matchMode": "contains", "enabled": True},
    ],
    "trainingMarkers": [
        {"id": "tr_dianlixunlian", "term": "【典例训练】", "matchMode": "contains", "enabled": True},
        {"id": "tr_liti", "term": "【例题】", "matchMode": "contains", "enabled": True},
        {"id": "tr_jiedati", "term": "一、解答题", "matchMode": "contains", "enabled": True},
        {"id": "tr_danxuanti", "term": "一、单选题", "matchMode": "contains", "enabled": True},
        {"id": "tr_xuanzeti", "term": "一、选择题", "matchMode": "contains", "enabled": True},
        {"id": "tr_tiankongti", "term": "二、填空题", "matchMode": "contains", "enabled": True},
        {"id": "tr_duoxuanti_1", "term": "三、多选题", "matchMode": "contains", "enabled": True},
        {"id": "tr_duoxuanti_2", "term": "二、多选题", "matchMode": "contains", "enabled": True},
    ],
    "nonQuestionRemainders": [
        {"id": "nqr_qitalleixing", "term": "其他类型", "matchMode": "contains", "enabled": True},
        {"id": "nqr_changjianleixing", "term": "常见类型", "matchMode": "contains", "enabled": True},
        {"id": "nqr_fangfazongjie", "term": "方法总结", "matchMode": "contains", "enabled": True},
        {"id": "nqr_guilvzongjie", "term": "规律总结", "matchMode": "contains", "enabled": True},
    ],
    "sectionMarkers": [
        {"id": "sec_tixing", "term": "题型", "matchMode": "contains", "enabled": True},
        {"id": "sec_jietiguilv", "term": "【解题规律", "matchMode": "contains", "enabled": True},
        {"id": "sec_dianlixunlian", "term": "【典例训练】", "matchMode": "contains", "enabled": True},
        {"id": "sec_mulu", "term": "目录", "matchMode": "contains", "enabled": True},
        {"id": "sec_tixingguina", "term": "题型归纳", "matchMode": "contains", "enabled": True},
        {"id": "sec_tixingtanxi", "term": "题型探析", "matchMode": "contains", "enabled": True},
    ],
}

CATEGORIES = (
    "auxiliaryMarkers",
    "noticeTerms",
    "referenceFormulaMarkers",
    "trainingMarkers",
    "nonQuestionRemainders",
    "sectionMarkers",
)


@dataclass(frozen=True)
class RuleEntry:
    id: str
    term: str
    match_mode: str = MATCH_CONTAINS
    enabled: bool = True


@dataclass(frozen=True)
class SlicerRules:
    auxiliary_markers: tuple[RuleEntry, ...] = field(default_factory=tuple)
    notice_terms: tuple[RuleEntry, ...] = field(default_factory=tuple)
    reference_formula_markers: tuple[RuleEntry, ...] = field(default_factory=tuple)
    training_markers: tuple[RuleEntry, ...] = field(default_factory=tuple)
    non_question_remainders: tuple[RuleEntry, ...] = field(default_factory=tuple)
    section_markers: tuple[RuleEntry, ...] = field(default_factory=tuple)
    version: int = 1

    @property
    def enabled_auxiliary_markers(self) -> tuple[RuleEntry, ...]:
        return tuple(entry for entry in self.auxiliary_markers if entry.enabled)

    @property
    def enabled_notice_terms(self) -> tuple[RuleEntry, ...]:
        return tuple(entry for entry in self.notice_terms if entry.enabled)

    @property
    def enabled_reference_formula_markers(self) -> tuple[RuleEntry, ...]:
        return tuple(entry for entry in self.reference_formula_markers if entry.enabled)

    @property
    def enabled_training_markers(self) -> tuple[RuleEntry, ...]:
        return tuple(entry for entry in self.training_markers if entry.enabled)

    @property
    def enabled_non_question_remainders(self) -> tuple[RuleEntry, ...]:
        return tuple(entry for entry in self.non_question_remainders if entry.enabled)

    @property
    def enabled_section_markers(self) -> tuple[RuleEntry, ...]:
        return tuple(entry for entry in self.section_markers if entry.enabled)

    @property
    def auxiliary_terms(self) -> tuple[str, ...]:
        return tuple(e.term for e in self.auxiliary_markers if e.enabled)

    @property
    def notice_terms_tuple(self) -> tuple[str, ...]:
        return tuple(e.term for e in self.notice_terms if e.enabled)

    @property
    def reference_formula_terms(self) -> tuple[str, ...]:
        return tuple(e.term for e in self.reference_formula_markers if e.enabled)

    @property
    def training_terms(self) -> tuple[str, ...]:
        return tuple(e.term for e in self.training_markers if e.enabled)

    @property
    def non_question_remainder_terms(self) -> tuple[str, ...]:
        return tuple(e.term for e in self.non_question_remainders if e.enabled)

    @property
    def section_terms(self) -> tuple[str, ...]:
        return tuple(e.term for e in self.section_markers if e.enabled)


def _normalize_match_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = value.replace("　", " ").replace("､", "、")
    return re.sub(r"\s+", " ", value).strip()


def rule_matches(text: str, rule: RuleEntry | str) -> bool:
    """Match one rule entry against a line of PDF text.

    String rules keep the old fallback behaviour (contains matching).  Configured
    RuleEntry values additionally honour the setting page's exact/contains choice.
    """
    if isinstance(rule, str):
        term = _normalize_match_text(rule)
        return bool(term) and term in _normalize_match_text(text)

    term = _normalize_match_text(rule.term)
    candidate = _normalize_match_text(text)
    if not term:
        return False
    if rule.match_mode == MATCH_EXACT:
        return candidate == term
    return term in candidate


def any_rule_matches(text: str, rules: tuple[RuleEntry | str, ...]) -> bool:
    return any(rule_matches(text, rule) for rule in rules)


def _make_id(prefix: str, term: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", term.lower().strip()).strip("_")
    return f"{prefix}_{slug}"[:48]


def _parse_entries(entries: list[dict]) -> list[RuleEntry]:
    return [
        RuleEntry(
            id=entry.get("id", ""),
            term=entry.get("term", ""),
            match_mode=entry.get("matchMode", MATCH_CONTAINS),
            enabled=entry.get("enabled", True),
        )
        for entry in entries
        if entry.get("term")
    ]


def _parse_rules_dict(data: dict) -> SlicerRules:
    return SlicerRules(
        auxiliary_markers=tuple(_parse_entries(data.get("auxiliaryMarkers", []))),
        notice_terms=tuple(_parse_entries(data.get("noticeTerms", []))),
        reference_formula_markers=tuple(_parse_entries(data.get("referenceFormulaMarkers", []))),
        training_markers=tuple(_parse_entries(data.get("trainingMarkers", []))),
        non_question_remainders=tuple(_parse_entries(data.get("nonQuestionRemainders", []))),
        section_markers=tuple(_parse_entries(data.get("sectionMarkers", []))),
        version=int(data.get("version", 1)),
    )


def validate_rules_data(data: dict) -> list[str]:
    """Validate a rules JSON dict. Returns list of warning/error strings. Empty = valid."""
    warnings: list[str] = []
    for cat in CATEGORIES:
        entries = data.get(cat, [])
        if not isinstance(entries, list):
            warnings.append(f"{cat}: 应为数组，实际为 {type(entries).__name__}")
            continue
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict):
                warnings.append(f"{cat}[{i}]: 应为对象")
                continue
            if "id" not in entry or not entry.get("id"):
                warnings.append(f"{cat}[{i}]: 缺少 id")
            if "term" not in entry or not entry.get("term"):
                warnings.append(f"{cat}[{i}]: 缺少 term")
            match_mode = entry.get("matchMode", MATCH_CONTAINS)
            if match_mode not in MATCH_MODES:
                warnings.append(f"{cat}[{i}]: matchMode 必须为 contains 或 exact，实际为 '{match_mode}'")
    return warnings


def compute_rules_hash(data: dict) -> str:
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def load_rules(path: Optional[Path] = None) -> tuple[SlicerRules, bool, dict]:
    """Load rules from JSON file.

    Returns (SlicerRules, fallback_used, extra_info) where extra_info contains
    the hash of the loaded data and any validation warnings.

    If path is None or file is missing/invalid, returns built-in defaults with
    fallback_used=True.
    """
    if path is None or not path.exists():
        rules = _parse_rules_dict(_DEFAULT_RULES_JSON)
        info = {"hash": compute_rules_hash(_DEFAULT_RULES_JSON), "warnings": []}
        return rules, True, info

    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        rules = _parse_rules_dict(data)
        warnings = validate_rules_data(data)
        info = {"hash": compute_rules_hash(data), "warnings": warnings}
        return rules, False, info
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        rules = _parse_rules_dict(_DEFAULT_RULES_JSON)
        info = {"hash": compute_rules_hash(_DEFAULT_RULES_JSON), "warnings": [f"规则文件解析失败: {exc}，已使用内置默认规则"]}
        return rules, True, info
