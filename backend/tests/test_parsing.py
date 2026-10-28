import pytest

from app.parsing import ParseError, extract_text

from .conftest import make_blank_pdf

MB = 1024 * 1024


def test_pdf_text(pdf_bytes):
    assert "6 years of Python" in extract_text("cv.pdf", pdf_bytes, 5 * MB)


def test_docx_text(docx_bytes):
    assert "6 years of Python" in extract_text("cv.docx", docx_bytes, 5 * MB)


@pytest.mark.parametrize(
    "name,data,code",
    [
        ("cv.txt", b"hello", 415),
        ("cv.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest", 415),
        ("cv.pdf", b"PK\x03\x04 not a pdf", 415),
        ("cv.docx", b"%PDF- not a docx", 415),
        ("cv.pdf", b"%PDF-1.4 garbage", 422),
        ("cv.docx", b"PK\x03\x04garbage", 422),
    ],
)
def test_rejects_bad_files(name, data, code):
    with pytest.raises(ParseError) as e:
        extract_text(name, data, 5 * MB)
    assert e.value.status_code == code


def test_empty_text_layer():
    with pytest.raises(ParseError) as e:
        extract_text("scan.pdf", make_blank_pdf(), 5 * MB)
    assert e.value.status_code == 422
    assert "OCR" in e.value.message


def test_oversize(pdf_bytes):
    with pytest.raises(ParseError) as e:
        extract_text("cv.pdf", pdf_bytes, 100)
    assert e.value.status_code == 413
