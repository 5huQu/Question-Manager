#!/usr/bin/env python3
"""Single question-bank item format cleanup."""

from __future__ import annotations

import argparse
import json
import sys

from format_cleanup_for_question import (
    FIELD_KEYS,
    TAG_KEYS,
    call_classification_model,
    call_cleanup_model,
    cleanup_concurrency,
    detect_model_cleanup_reasons,
    difficulty_label,
    difficulty_score,
    has_classification,
    normalize_tags,
    render_error_reasons,
    script_clean,
    validate_render_errors,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清洗单个题库题目")
    parser.add_argument("--model", action="store_true", help="必要时调用清洗模型")
    parser.add_argument("--classify", action="store_true", help="同步生成知识点、解题方法与难度")
    parser.add_argument("--concurrency", type=int, default=None)
    return parser.parse_args()


def cleanup_item(data: dict[str, object], *, use_model: bool, classify: bool) -> dict[str, object]:
    cleaned, changed, post = script_clean(data)
    pre_reasons = detect_model_cleanup_reasons(cleaned, include_review_reasons=True)
    render_errors = validate_render_errors(cleaned)
    reasons = sorted(set(pre_reasons + render_error_reasons(render_errors)))
    model_error = ""
    classification_error = ""
    model_attempted = False
    model_resolved = False
    classification_attempted = False
    classification_resolved = False

    if use_model and reasons:
        model_attempted = True
        for attempt in range(2):
            try:
                before_model = {key: cleaned.get(key, "") for key in FIELD_KEYS}
                cleaned = call_cleanup_model(cleaned, reasons, render_errors)
                model_field_changed = any(before_model.get(key, "") != cleaned.get(key, "") for key in FIELD_KEYS)
                cleaned, model_changed, post2 = script_clean(cleaned)
                changed = changed or model_field_changed or model_changed
                post = {**post, **post2}
                render_errors = validate_render_errors(cleaned)
                reasons = sorted(set(detect_model_cleanup_reasons(cleaned, include_review_reasons=False) + render_error_reasons(render_errors)))
                if not reasons:
                    pp = dict(cleaned.get("post_processing") or {})
                    fc = dict(pp.get("format_cleanup") or {})
                    fc["model_reviewed"] = True
                    fc["model_cleanup_attempts"] = attempt + 1
                    pp["format_cleanup"] = fc
                    cleaned["post_processing"] = pp
                    changed = True
                    model_resolved = True
                    break
            except Exception as exc:
                model_error = str(exc)
                break

    if classify and (not has_classification(cleaned) or (use_model and reasons)):
        classification_attempted = True
        try:
            before_tags = {key: normalize_tags(cleaned.get(key)) for key in TAG_KEYS}
            before_score = difficulty_score(cleaned.get("difficulty_score_10"))
            tagged = cleaned if (use_model and reasons) else call_classification_model(cleaned)
            for key in TAG_KEYS:
                cleaned[key] = normalize_tags(tagged.get(key))
            score = difficulty_score(tagged.get("difficulty_score_10"))
            if score:
                cleaned["difficulty_score_10"] = score
                cleaned["difficulty_label"] = difficulty_label(score)
            classification_resolved = bool(normalize_tags(cleaned.get("knowledge_points")) or normalize_tags(cleaned.get("solution_methods"))) and difficulty_score(cleaned.get("difficulty_score_10")) > 0
            changed = changed or any(before_tags[key] != normalize_tags(cleaned.get(key)) for key in TAG_KEYS) or before_score != difficulty_score(cleaned.get("difficulty_score_10"))
        except Exception as exc:
            classification_error = str(exc)

    return {
        "item": {
            "stemMarkdown": cleaned.get("problem_text", ""),
            "answerText": cleaned.get("answer", ""),
            "analysisMarkdown": cleaned.get("analysis", ""),
            "knowledgePoints": normalize_tags(cleaned.get("knowledge_points")),
            "solutionMethods": normalize_tags(cleaned.get("solution_methods")),
            "difficultyScore10": difficulty_score(cleaned.get("difficulty_score_10")),
            "difficultyLabel": cleaned.get("difficulty_label") or difficulty_label(difficulty_score(cleaned.get("difficulty_score_10"))),
        },
        "record": {
            "id": data.get("id", ""),
            "scriptChanged": changed,
            "needsModelCleanup": bool(reasons),
            "reasons": reasons,
            "renderErrors": render_errors,
            "modelError": model_error,
            "classificationError": classification_error,
            "knowledgePoints": normalize_tags(cleaned.get("knowledge_points")),
            "solutionMethods": normalize_tags(cleaned.get("solution_methods")),
            "difficultyScore10": difficulty_score(cleaned.get("difficulty_score_10")),
            "difficultyLabel": cleaned.get("difficulty_label") or difficulty_label(difficulty_score(cleaned.get("difficulty_score_10"))),
            "modelAttempted": model_attempted,
            "modelResolved": model_resolved,
            "classificationAttempted": classification_attempted,
            "classificationResolved": classification_resolved,
        },
    }


def main() -> int:
    args = parse_args()
    cleanup_concurrency(args.concurrency)
    payload = json.loads(sys.stdin.read() or "{}")
    result = cleanup_item(payload, use_model=args.model, classify=args.classify)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
