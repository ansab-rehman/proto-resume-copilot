"""Resume text extraction for PDF and DOCX, with clear per-file errors."""

import io
import zipfile

import docx
from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_RESUME_CHARS = 60_000

_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # legacy .doc


class ParseError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def extract_text(filename: str, data: bytes, max_bytes: int) -> str:
    if len(data) > max_bytes:
        raise ParseError(413, f"File is larger than {max_bytes // (1024 * 1024)} MB.")
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if ext == "doc" or data.startswith(_OLE_MAGIC):
        raise ParseError(415, "Legacy .doc is not supported. Save as .docx or PDF.")
    if ext == "pdf" and data.startswith(_PDF_MAGIC):
        text = _pdf_text(data)
    elif ext == "docx" and data.startswith(_ZIP_MAGIC):
        text = _docx_text(data)
    elif ext in ("pdf", "docx"):
        raise ParseError(415, f"File content doesn't look like a .{ext} file.")
    else:
        raise ParseError(415, "Unsupported file type. Upload a PDF or .docx.")

    text = text.strip()
    if not text:
        raise ParseError(
            422, "No extractable text — the file may be scanned (no text layer; OCR not supported)."
        )
    if len(text) > MAX_RESUME_CHARS:
        raise ParseError(422, "Document is too long to be a resume.")
    return text


def _pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ParseError(422, "PDF is password-protected.")
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except ParseError:
        raise
    except (PdfReadError, ValueError, KeyError, OSError) as e:
        raise ParseError(422, "Couldn't read this PDF; it may be corrupted.") from e


def _docx_text(data: bytes) -> str:
    try:
        d = docx.Document(io.BytesIO(data))
    except (zipfile.BadZipFile, KeyError, ValueError) as e:
        raise ParseError(422, "Couldn't read this .docx; it may be corrupted.") from e
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(parts)
