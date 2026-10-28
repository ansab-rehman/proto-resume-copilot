import io

import docx
import pytest
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def make_pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    y = 750
    for line in lines:
        c.drawString(72, y, line)
        y -= 16
    c.save()
    return buf.getvalue()


def make_blank_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.showPage()
    c.save()
    return buf.getvalue()


def make_docx(lines: list[str]) -> bytes:
    d = docx.Document()
    for line in lines:
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


@pytest.fixture
def pdf_bytes():
    return make_pdf(["Jane Doe", "Senior Engineer with 6 years of Python"])


@pytest.fixture
def docx_bytes():
    return make_docx(["Jane Doe", "Senior Engineer with 6 years of Python"])
