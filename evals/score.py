"""Score predictions against labels. Both files are JSON Lines: {"id": ..., "label": ...}.

python3 evals/score.py LABELS PREDICTIONS [--min 0.8] [--compare PREDICTIONS2]
python3 evals/score.py --selftest
"""
import json
import sys
from collections import Counter


def load(path):
    with open(path) as f:
        return {r["id"]: r["label"] for r in map(json.loads, filter(str.strip, f))}


def score(labels, preds):
    tp, fp, fn = Counter(), Counter(), Counter()
    for i, y in labels.items():
        p = preds.get(i)  # missing prediction = wrong, so skipped items can't hide
        if p == y:
            tp[y] += 1
        else:
            fn[y] += 1
            if p is not None:
                fp[p] += 1
    classes = sorted(set(labels.values()) | {preds[i] for i in labels if i in preds})
    ratio = lambda a, b: round(a / b, 3) if b else None
    return {
        "n": len(labels),
        "accuracy": ratio(sum(tp.values()), len(labels)),
        "missing": [i for i in labels if i not in preds],
        "per_label": {c: {"precision": ratio(tp[c], tp[c] + fp[c]), "recall": ratio(tp[c], tp[c] + fn[c])}
                      for c in classes},
    }


def flip_rate(a, b):
    """Share of ids answered differently by two runs of the same input: the noise floor."""
    common = a.keys() & b.keys()
    return round(sum(a[i] != b[i] for i in common) / len(common), 3) if common else None


def selftest():
    labels = {"1": "ok", "2": "gap", "3": "gap", "4": "ok"}
    r = score(labels, {"1": "ok", "2": "gap", "3": "ok"})
    assert r["accuracy"] == 0.5 and r["missing"] == ["4"]
    assert r["per_label"]["gap"] == {"precision": 1.0, "recall": 0.5}
    assert r["per_label"]["ok"] == {"precision": 0.5, "recall": 0.5}
    assert flip_rate({"1": "ok", "2": "gap"}, {"1": "ok", "2": "ok", "9": "x"}) == 0.5
    assert score({}, {})["accuracy"] is None
    print("selftest ok")


def main(argv):
    if argv[:1] == ["--selftest"]:
        return selftest()
    if len(argv) < 2:
        sys.exit(__doc__)
    opts = dict(zip(argv[2::2], argv[3::2]))
    preds = load(argv[1])
    result = score(load(argv[0]), preds)
    if "--compare" in opts:
        result["flip_rate"] = flip_rate(preds, load(opts["--compare"]))
    print(json.dumps(result, indent=2))
    if "--min" in opts and (result["accuracy"] or 0) < float(opts["--min"]):
        sys.exit(f"accuracy {result['accuracy']} below --min {opts['--min']}")


if __name__ == "__main__":
    main(sys.argv[1:])
