#!/usr/bin/env python3
"""Single writer for the release-local guide pack; no network or dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCES = Path(__file__).with_name("sources.json")
OUTPUT = ROOT / "crates/nac-core/src/guide/pack.json"
ROUTER = ROOT / "crates/nac-core/src/guide/router.md"
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def headings(text):
    """Return real Markdown heading offsets, excluding fenced code samples."""
    fence = None
    offset = 0
    result = []
    for line in text.splitlines(keepends=True):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
        elif fence is None:
            heading = re.match(r"^(#{1,6}) (.+?)\s*#*\s*$", line)
            if heading:
                result.append((len(heading[1]), heading[2], offset))
        offset += len(line)
    return result


def anchor(title):
    title = re.sub(r"[^\w\- ]", "", title.lower())
    return title.replace(" ", "-")


def check_links(path, text):
    # Markdown file/image links only; external links are not fetched or trusted.
    for target in re.findall(r"!?\[[^\]]*\]\(([^\s)]+)(?:\s+\"[^\"]*\")?\)", text):
        target = target.strip("<>")
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
            continue
        filename, _, section = target.partition("#")
        destination = (path.parent / filename).resolve() if filename else path
        if not destination.is_relative_to(ROOT) or not destination.exists():
            raise ValueError(f"{path.relative_to(ROOT)}: missing local link {target}")
        if section and destination.suffix == ".md":
            ids = [anchor(title) for _, title, _ in headings(destination.read_text())]
            if section not in ids and f'id="{section}"' not in destination.read_text():
                raise ValueError(f"{path.relative_to(ROOT)}: missing heading {target}")


def generate(sources=None):
    sources = sources if sources is not None else json.loads(SOURCES.read_text())
    documents = []
    seen = set()
    for source in sources:
        document_id = source["document_id"]
        if not ID.fullmatch(document_id) or document_id in seen:
            raise ValueError(f"invalid/duplicate document ID: {document_id}")
        seen.add(document_id)
        path = (ROOT / source["source_path"]).resolve()
        if not path.is_relative_to(ROOT) or path.suffix != ".md":
            raise ValueError("guide sources must be repository Markdown files")
        text = path.read_text()
        if not text or len(text.encode()) > 131072:
            raise ValueError(f"empty/oversized source: {document_id}")
        check_links(path, text)
        actual = [(title, offset) for level, title, offset in headings(text) if level == 2]
        if [title for title, _ in actual] != [part["heading"] for part in source["sections"]]:
            raise ValueError(f"{document_id}: headings drifted; preserve IDs in sources.json")
        sections = []
        boundaries = [("overview", source["title"], 0)] + [
            (part["section_id"], title, offset)
            for part, (title, offset) in zip(source["sections"], actual)
        ]
        ids = set()
        for index, (section_id, title, offset) in enumerate(boundaries):
            if not ID.fullmatch(section_id) or section_id in ids:
                raise ValueError(f"invalid/duplicate section ID: {document_id}#{section_id}")
            ids.add(section_id)
            end = boundaries[index + 1][2] if index + 1 < len(boundaries) else len(text)
            sections.append(dict(section_id=section_id, title=title, text=text[offset:end]))
        documents.append(dict(document_id=document_id, title=source["title"],
                              source_path=source["source_path"], content_digest=digest(text),
                              sections=sections))
    router_digest = digest(ROUTER.read_text())
    fingerprint_input = f"1\n{router_digest}\n" + "".join(
        f'{doc["document_id"]}:{doc["source_path"]}:{doc["content_digest"]}:{doc["title"]}\n' +
        "".join(f'{section["section_id"]}:{section["title"]}\n' for section in doc["sections"])
        for doc in documents)
    pack = dict(schema_version=1,
                fingerprint=digest(fingerprint_input), router_digest=router_digest,
                documents=documents)
    encoded = json.dumps(pack, ensure_ascii=False, indent=2) + "\n"
    if len(encoded.encode()) > 524288:
        raise ValueError("guide pack exceeds 512 KiB")
    return encoded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        content = generate()
        if args.check:
            if not OUTPUT.exists() or OUTPUT.read_text() != content:
                raise ValueError("guide pack drift; run make generate-nac-guide")
        else:
            OUTPUT.write_text(content)
    except (ValueError, OSError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
