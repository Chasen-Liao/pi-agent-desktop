#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Minimal standard-library OOXML writer for the Img2PPT scene DOM.

The writer supports images, image-filled shapes, native shapes, editable text,
and rich-text runs. It does not generate note parts.

spec.json schema; all coordinates are in inches:
  {
    "slide": {"w":13.4375, "h":7.5},
    "img_px": [2752,1536],
    "bg_color": "F1F3F8",
    "bg_images": ["assets/background/background_01.png"],
    "items": [
      {"type":"image","path":"assets/hero/hero_01.png","box":[x,y,w,h]},
      {"type":"image","path":"assets/container.png","box":[...],"shape":"roundRect","rect_radius":0.10},
      {"type":"shape","box":[...],"shape":"roundRect","fill":"FFFFFF","border":"E8E8E8","border_w":1,"rect_radius":0.10},
      {"type":"text","box":[...],"text":"...","color":"18181B","pt":14,"bold":false,"align":"l","valign":"t","line_pct":124},
      {"type":"text","box":[...],"runs":[{"text":"16","color":"0E468E","pt":24,"bold":true},{"text":" skills","color":"1A1A1A","pt":13,"bold":true}],"align":"l","valign":"ctr"}
    ]
  }
  Item order is z-order: earlier items render below later items.
  Colors are six-digit hexadecimal strings without # or alpha.

Usage:
    python scripts/pptx_native.py <img_dir> [--spec spec.json] [--out out.pptx]
Dependencies: Python standard library only. Requires Python 3.9 or newer.
"""
import argparse
import json
import os
import sys
import zipfile

EMU_IN = 914400

A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
FONT_EA, FONT_LT = "Microsoft YaHei", "Arial"
ALIGN = {"l": "l", "left": "l", "c": "ctr", "ctr": "ctr", "center": "ctr", "r": "r", "right": "r"}
ANCHOR = {"t": "t", "top": "t", "ctr": "ctr", "c": "ctr", "middle": "ctr", "b": "b", "bottom": "b"}


def emu(inch):
    return str(int(round(float(inch) * EMU_IN)))


def esc(t):
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def sz(pt):
    return str(int(round(float(pt) * 100)))


def _hex(c):
    return (c or "000000").lstrip("#")[:6].upper()


def _radius_val(radius_in, w_in, h_in):
    cx, cy = float(w_in) * EMU_IN, float(h_in) * EMU_IN
    return max(0, min(50000, int(round(float(radius_in) * EMU_IN / max(1.0, min(cx, cy)) * 100000))))


def _xfrm(box, rotation_deg=0):
    x, y, w, h = box
    rotation = float(rotation_deg or 0)
    rot = f' rot="{int(round(rotation * 60000))}"' if rotation else ""
    return (f'<a:xfrm{rot}><a:off x="{emu(x)}" y="{emu(y)}"/>'
            f'<a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>')


def _srgb(color, opacity=1.0):
    opacity = max(0.0, min(1.0, float(opacity if opacity is not None else 1.0)))
    alpha = "" if opacity >= 0.9999 else f'<a:alpha val="{int(round(opacity * 100000))}"/>'
    return f'<a:srgbClr val="{_hex(color)}">{alpha}</a:srgbClr>'


# ---------------- Text ----------------
def _rpr(pt, color, bold, italic=False, font_face=None, font_face_ea=None):
    latin = font_face or FONT_LT
    east_asian = font_face_ea or font_face or FONT_EA
    return (f'<a:rPr lang="zh-CN" altLang="en-US" sz="{sz(pt)}" b="{1 if bold else 0}" '
            f'i="{1 if italic else 0}" dirty="0">'
            f'<a:solidFill><a:srgbClr val="{_hex(color)}"/></a:solidFill>'
            f'<a:latin typeface="{esc(latin)}"/><a:ea typeface="{esc(east_asian)}"/>'
            f'<a:cs typeface="{esc(latin)}"/></a:rPr>')


def _text_run_xml(text, rpr):
    """Emit text plus explicit DrawingML line breaks."""
    parts = str(text).split("\n")
    out = []
    for index, part in enumerate(parts):
        if index:
            out.append(f'<a:br>{rpr}</a:br>')
        preserve = ' xml:space="preserve"' if part[:1].isspace() or part[-1:].isspace() else ''
        out.append(f'<a:r>{rpr}<a:t{preserve}>{esc(part)}</a:t></a:r>')
    return "".join(out)


def _para(item):
    algn = ALIGN.get(item.get("align", "l"), "l")
    runs_src = item.get("runs") or [{"text": item.get("text", ""), "color": item.get("color", "18181B"),
                                     "pt": item.get("pt", 14), "bold": item.get("bold", False),
                                     "italic": item.get("italic", False),
                                     "font_face": item.get("font_face"),
                                     "font_face_ea": item.get("font_face_ea")}]
    base_pt = runs_src[0].get("pt", 14)
    base_col = runs_src[0].get("color", "18181B")
    base_font = runs_src[0].get("font_face") or item.get("font_face") or FONT_LT
    base_font_ea = runs_src[0].get("font_face_ea") or item.get("font_face_ea") or base_font or FONT_EA
    ppr = f'<a:pPr algn="{algn}">'
    if item.get("line_pct"):                       # spcPct stores thousandths of a percent: 138% -> 138000.
        ppr += f'<a:lnSpc><a:spcPct val="{int(round(float(item["line_pct"]) * 1000))}"/></a:lnSpc>'
    if item.get("space_before_pt"):
        ppr += f'<a:spcBef><a:spcPts val="{int(round(float(item["space_before_pt"]) * 100))}"/></a:spcBef>'
    ppr += '<a:buNone/>'
    ppr += (f'<a:defRPr lang="zh-CN" altLang="en-US" sz="{sz(base_pt)}">'
            f'<a:solidFill><a:srgbClr val="{_hex(base_col)}"/></a:solidFill>'
            f'<a:latin typeface="{esc(base_font)}"/><a:ea typeface="{esc(base_font_ea)}"/>'
            f'</a:defRPr></a:pPr>')
    runs = "".join(
        _text_run_xml(
            r.get("text", ""),
            _rpr(
                r.get("pt", base_pt),
                r.get("color", base_col),
                r.get("bold"),
                r.get("italic"),
                r.get("font_face") or item.get("font_face"),
                r.get("font_face_ea") or item.get("font_face_ea"),
            ),
        )
        for r in runs_src
    )
    endp = f'<a:endParaRPr lang="zh-CN" altLang="en-US" sz="{sz(base_pt)}"/>'
    return f'<a:p>{ppr}{runs}{endp}</a:p>'     # Strict order: pPr, runs, endParaRPr; exactly one pPr.


def text_sp(sid, name, box, item):
    x, y, w, h = box
    anchor = ANCHOR.get(item.get("valign", "t"), "t")
    autofit = '<a:normAutofit/>' if item.get("fit", "shrink") == "shrink" else ''
    margin = item.get("margin", 0)
    if isinstance(margin, (int, float)):
        margins = [margin] * 4
    else:
        margins = list(margin or [0, 0, 0, 0])
        margins = (margins + [0, 0, 0, 0])[:4]
    l_ins, t_ins, r_ins, b_ins = (emu(v) for v in margins)
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr>{_xfrm(box, item.get("rotation_deg"))}'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" lIns="{l_ins}" tIns="{t_ins}" rIns="{r_ins}" bIns="{b_ins}" anchor="{anchor}">{autofit}</a:bodyPr>'
            f'<a:lstStyle/>{_para(item)}</p:txBody></p:sp>')


# ---------------- Images and shapes ----------------
def pic_sp(sid, name, box, rid, item):
    x, y, w, h = box
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="{esc(name)}"/>'
            f'<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            f'<p:spPr>{_xfrm(box, item.get("rotation_deg"))}'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')


def shape_picfill_sp(sid, name, box, rid, radius_in, prst="roundRect", rotation_deg=0):
    """Create a native PowerPoint shape with an image fill."""
    x, y, w, h = box
    av = (f'<a:gd name="adj" fmla="val {_radius_val(radius_in, w, h)}"/>' if prst == "roundRect" else '')
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr>{_xfrm(box, rotation_deg)}'
            f'<a:prstGeom prst="{prst}"><a:avLst>{av}</a:avLst></a:prstGeom>'
            f'<a:blipFill rotWithShape="1"><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
            f'</p:spPr>'
            f'<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>')


def solid_shape_sp(sid, name, box, item):
    x, y, w, h = box
    prst = item.get("shape", "roundRect")
    av = (f'<a:gd name="adj" fmla="val {_radius_val(item.get("rect_radius", 0.1), w, h)}"/>'
          if prst == "roundRect" else '')
    fill = (f'<a:solidFill>{_srgb(item["fill"], item.get("opacity", 1.0))}</a:solidFill>'
            if item.get("fill") else '<a:noFill/>')
    if item.get("border"):
        ln = (f'<a:ln w="{int(round(float(item.get("border_w", 1)) * 12700))}">'
              f'<a:solidFill>{_srgb(item["border"], item.get("border_opacity", 1.0))}</a:solidFill>'
              f'<a:prstDash val="solid"/></a:ln>')
    else:
        ln = '<a:ln><a:noFill/></a:ln>'
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr>{_xfrm(box, item.get("rotation_deg"))}'
            f'<a:prstGeom prst="{prst}"><a:avLst>{av}</a:avLst></a:prstGeom>{fill}{ln}</p:spPr>'
            f'<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>')


# ---------------- Fixed parts: minimal strict-XSD template without notes ----------------
def _lvl1(szpt):
    return ('<a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">'
            f'<a:defRPr sz="{sz(szpt)}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
            '<a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr>')


THEME = (f'<a:theme xmlns:a="{A_NS}" name="Office Theme"><a:themeElements>'
         '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
         '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2>'
         '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>'
         '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>'
         '<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>'
         '<a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
         '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
         '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
         '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
         '<a:fmtScheme name="Office">'
         '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
         '<a:lnStyleLst>'
         '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'
         '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'
         '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'
         '</a:lnStyleLst>'
         '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>'
         '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
         '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements>'
         '<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>')

MASTER = (f'<p:sldMaster xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}"><p:cSld>'
          '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
          '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
          '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
          '</p:spTree></p:cSld>'
          '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" '
          'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
          '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
          f'<p:txStyles><p:titleStyle>{_lvl1(44)}</p:titleStyle><p:bodyStyle>{_lvl1(24)}</p:bodyStyle>'
          f'<p:otherStyle>{_lvl1(18)}</p:otherStyle></p:txStyles></p:sldMaster>')

LAYOUT = (f'<p:sldLayout xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}" type="blank" preserve="1">'
          '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
          '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
          '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')


def _rt(s):
    return f"http://schemas.openxmlformats.org/officeDocument/2006/relationships/{s}"


def _rels(pairs):
    body = ''.join(f'<Relationship Id="{i}" Type="{t}" Target="{tg}"/>' for i, t, tg in pairs)
    return DECL + f'<Relationships xmlns="{REL_NS}">{body}</Relationships>'


def build(img_dir, spec_path, out_path):
    with open(spec_path, encoding="utf-8") as spec_file:
        spec = json.load(spec_file)
    SW, SH = spec["slide"]["w"], spec["slide"]["h"]
    cx, cy = int(round(SW * EMU_IN)), int(round(SH * EMU_IN))

    media, rid_of = {}, {}
    rel_pairs = [("rId1", _rt("slideLayout"), "../slideLayouts/slideLayout1.xml")]
    counter = [2]

    def add_img(relpath):
        if relpath in rid_of:
            return rid_of[relpath]
        src = os.path.join(img_dir, relpath)
        if not os.path.exists(src):
            print(f"  ! missing asset; skipping: {relpath}", file=sys.stderr)
            return None
        ext = os.path.splitext(src)[1].lower().lstrip(".")
        if ext == "jpeg":
            ext = "jpg"
        if ext not in {"png", "jpg"}:
            ext = "png"
        mfn = f"image{counter[0]-1}.{ext}"
        media[relpath] = (mfn, src)
        rid = f"rId{counter[0]}"
        rel_pairs.append((rid, _rt("image"), f"../media/{mfn}"))
        rid_of[relpath] = rid
        counter[0] += 1
        return rid

    bg_images = spec.get("bg_images") or []
    bg_rid = add_img(bg_images[0]) if bg_images else None
    if bg_rid:
        bg = (f'<p:bg><p:bgPr><a:blipFill><a:blip r:embed="{bg_rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
              f'<a:effectLst/></p:bgPr></p:bg>')
    else:
        bg = (f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{_hex(spec.get("bg_color","FFFFFF"))}"/>'
              f'</a:solidFill><a:effectLst/></p:bgPr></p:bg>')

    shapes, sid = [], 2
    for it in spec.get("items", []):
        t, box = it.get("type"), it.get("box")
        if not box:
            continue
        if t == "image":
            rid = add_img(it["path"])
            if not rid:
                continue
            if it.get("shape") == "roundRect" or it.get("shape"):
                shapes.append(shape_picfill_sp(sid, it.get("role") or f"picfill_{sid}", box, rid,
                                               it.get("rect_radius", 0.10), it.get("shape", "roundRect"),
                                               it.get("rotation_deg", 0)))
            else:
                shapes.append(pic_sp(sid, it.get("role") or f"pic_{sid}", box, rid, it))
            sid += 1
        elif t == "shape":
            shapes.append(solid_shape_sp(sid, it.get("role") or f"shape_{sid}", box, it))
            sid += 1
        elif t == "text":
            shapes.append(text_sp(sid, it.get("role") or f"text_{sid}", box, it))
            sid += 1
        else:
            print(f"  ! unknown item.type={t}; skipping", file=sys.stderr)

    slide = (DECL + f'<p:sld xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}"><p:cSld>{bg}'
             '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
             '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
             + ''.join(shapes) + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')

    presentation = (DECL + f'<p:presentation xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}" saveSubsetFonts="1">'
                    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
                    '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>'
                    f'<p:sldSz cx="{cx}" cy="{cy}"/><p:notesSz cx="6858000" cy="9144000"/>'
                    f'<p:defaultTextStyle>{_lvl1(18)}</p:defaultTextStyle></p:presentation>')

    CT = "application/vnd.openxmlformats-officedocument.presentationml."
    parts = {
        "[Content_Types].xml": DECL +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
            '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
            f'<Override PartName="/ppt/presentation.xml" ContentType="{CT}presentation.main+xml"/>'
            f'<Override PartName="/ppt/slides/slide1.xml" ContentType="{CT}slide+xml"/>'
            f'<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="{CT}slideLayout+xml"/>'
            f'<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="{CT}slideMaster+xml"/>'
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            '</Types>',
        "_rels/.rels": _rels([("rId1", _rt("officeDocument"), "ppt/presentation.xml"),
                              ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
                              ("rId3", _rt("extended-properties"), "docProps/app.xml")]),
        "ppt/presentation.xml": presentation,
        "ppt/_rels/presentation.xml.rels": _rels([("rId1", _rt("slideMaster"), "slideMasters/slideMaster1.xml"),
                                                  ("rId2", _rt("slide"), "slides/slide1.xml"),
                                                  ("rId3", _rt("theme"), "theme/theme1.xml")]),
        "ppt/slideMasters/slideMaster1.xml": MASTER,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": _rels([("rId1", _rt("slideLayout"), "../slideLayouts/slideLayout1.xml"),
                                                               ("rId2", _rt("theme"), "../theme/theme1.xml")]),
        "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": _rels([("rId1", _rt("slideMaster"), "../slideMasters/slideMaster1.xml")]),
        "ppt/slides/slide1.xml": slide,
        "ppt/slides/_rels/slide1.xml.rels": _rels(rel_pairs),
        "ppt/theme/theme1.xml": THEME,
        "docProps/core.xml": DECL +
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>'
            '<dc:creator>ppt-skills</dc:creator><cp:lastModifiedBy>ppt-skills</cp:lastModifiedBy>'
            '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>'
            f'<dc:title>{esc(spec.get("title","Presentation"))}</dc:title></cp:coreProperties>',
        "docProps/app.xml": DECL +
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            '<Application>Microsoft Office PowerPoint</Application><Slides>1</Slides></Properties>',
    }
    for relpath, (mfn, src) in media.items():
        with open(src, "rb") as media_file:
            parts[f"ppt/media/{mfn}"] = media_file.read()

    import xml.etree.ElementTree as ET
    for nm, data in parts.items():
        if isinstance(data, (bytes, bytearray)):
            continue
        try:
            ET.fromstring(data)
        except ET.ParseError as e:
            raise SystemExit(f"[malformed XML] {nm}: {e}")

    if os.path.exists(out_path):
        os.remove(out_path)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for nm, data in parts.items():
            z.writestr(nm, data)
    n_picfill = slide.count('<a:blipFill rotWithShape')
    print(f"[pptx_native] {out_path} ({os.path.getsize(out_path)} bytes)")
    print(f"   parts={len(parts)} media={len(media)} image_filled_shapes={n_picfill} "
          f"pictures={slide.count('<p:pic>')} background={'image' if bg_rid else 'solid'} "
          f"text_runs={slide.count('<a:t>')} note_parts=0")
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("img_dir", help="single-image case directory containing spec.json and assets")
    ap.add_argument("--spec", default="spec.json")
    ap.add_argument("--out", default=None, help="output .pptx; defaults to <img_dir>/src_slide.pptx")
    a = ap.parse_args()
    img_dir = os.path.abspath(a.img_dir)
    build(img_dir, os.path.join(img_dir, a.spec),
          os.path.join(img_dir, a.out) if a.out else os.path.join(img_dir, "src_slide.pptx"))


if __name__ == "__main__":
    main()
