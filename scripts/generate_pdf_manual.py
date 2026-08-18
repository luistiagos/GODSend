import sys
import os
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT

def fmt_md(text):
    # Escape HTML special chars first
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Convert bold **text** -> <b>text</b>
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    # Convert code `text` -> <font face="Courier">text</font>
    text = re.sub(r'`(.*?)`', r'<font face="Courier">\1</font>', text)
    return text

def build_pdf(md_path, pdf_path):
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    # Custom color palette
    PRIMARY_COLOR = colors.HexColor("#107C41")    # Xbox Green
    SECONDARY_COLOR = colors.HexColor("#0E6233")  # Darker Green
    TEXT_DARK = colors.HexColor("#1A1A1A")        # Dark Charcoal
    BG_CALLOUT = colors.HexColor("#F0F9F3")       # Soft Light Green Tint
    BORDER_CALLOUT = colors.HexColor("#A8E0BC")

    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=PRIMARY_COLOR,
        alignment=TA_CENTER,
        spaceAfter=6
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#444444"),
        alignment=TA_CENTER,
        spaceAfter=12
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=PRIMARY_COLOR,
        spaceBefore=12,
        spaceAfter=5,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=SECONDARY_COLOR,
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=TEXT_DARK,
        spaceAfter=5,
        alignment=TA_LEFT
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=TEXT_DARK,
        leftIndent=14,
        spaceAfter=3
    )

    callout_style = ParagraphStyle(
        'Callout_Text',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#1C4D2E")
    )

    with open(md_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    story = []

    # Title & Subtitle
    story.append(Paragraph("Manual de Instalação e Gerenciamento de Jogos<br/>no Xbox 360 (Aurora Dashboard)", title_style))
    story.append(Paragraph("<b>Aplicação:</b> Xbox Companion &nbsp;|&nbsp; <b>Dashboard Alvo:</b> Aurora (RGH / JTAG)", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_COLOR, spaceBefore=0, spaceAfter=10))

    for line in lines:
        raw_line = line.strip()

        if not raw_line or raw_line.startswith("# Manual") or raw_line.startswith("> **Aplicação"):
            continue

        if raw_line == "---":
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#E0E0E0"), spaceBefore=4, spaceAfter=6))
            continue

        # Headers
        if raw_line.startswith("## "):
            text = fmt_md(raw_line[3:].strip())
            story.append(Paragraph(text, h1_style))
            continue
        elif raw_line.startswith("### "):
            text = fmt_md(raw_line[4:].strip())
            story.append(Paragraph(text, h2_style))
            continue

        # Callouts / Quotes
        if raw_line.startswith("> ") or raw_line.startswith("* **Zero necessidade") or raw_line.startswith("* **Formatação Integrada") or raw_line.startswith("* **Transferência Automática"):
            clean_text = raw_line.lstrip("> ").lstrip("* ").strip()
            formatted_text = fmt_md(clean_text)
            
            p = Paragraph(formatted_text, callout_style)
            t = Table([[p]], colWidths=[540])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), BG_CALLOUT),
                ('BOX', (0, 0), (-1, -1), 1, BORDER_CALLOUT),
                ('PADDING', (0, 0), (-1, -1), 6),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ]))
            story.append(Spacer(1, 2))
            story.append(t)
            story.append(Spacer(1, 3))
            continue

        # Bullet points
        if raw_line.startswith("* ") or raw_line.startswith("- "):
            text = fmt_md(raw_line[2:].strip())
            story.append(Paragraph(f"• {text}", bullet_style))
            continue

        # Numbered list
        if raw_line[0].isdigit() and len(raw_line) > 2 and (raw_line[1] == '.' or raw_line[2] == '.'):
            parts = raw_line.split('.', 1)
            num = parts[0].strip()
            text = fmt_md(parts[1].strip())
            story.append(Paragraph(f"<b>{num}.</b> {text}", bullet_style))
            continue

        # Regular Body Text
        text = fmt_md(raw_line)
        story.append(Paragraph(text, body_style))

    doc.build(story)
    print(f"PDF criado com sucesso em: {pdf_path}")

if __name__ == "__main__":
    md = r"e:\projects\Downloader-XBOX360-XEX-HDD-Games\docs\MANUAL-JOGOS-XBOX-COMPANION.md"
    pdf = r"e:\projects\Downloader-XBOX360-XEX-HDD-Games\docs\MANUAL-JOGOS-XBOX-COMPANION.pdf"
    build_pdf(md, pdf)
