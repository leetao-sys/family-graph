"""默认称谓规则表（普通话通用称谓）。

关系链由以下记号用逗号连接，表示“A 的 X 的 Y …”：
  f 父  m 母  h 夫  w 妻  s 子  d 女
  ob 兄  yb 弟  os 姐  ys 妹（兄弟姐妹的长幼相对于前一个人）
同辈的堂表亲在记号后附 &o / &y，表示其比同辈的直系（本人或本人的长辈）年长 / 年幼。
规则存入数据库 kinship_rules 表，管理员可修改或扩展（如方言称谓）。
"""

B = ("ob", "yb")  # 兄弟
Z = ("os", "ys")  # 姐妹
SIB = B + Z
OY = ("&o", "&y")


def build_default_rules() -> dict[str, str]:
    r: dict[str, str] = {}

    def add(chain: str, term: str) -> None:
        r[chain] = term

    def cousin(prefix: str, older_m: str, younger_m: str, older_f: str, younger_f: str) -> None:
        add(f"{prefix},s&o", older_m)
        add(f"{prefix},s&y", younger_m)
        add(f"{prefix},d&o", older_f)
        add(f"{prefix},d&y", younger_f)

    # —— 直系 ——
    for chain, term in {
        "f": "父亲", "m": "母亲", "h": "丈夫", "w": "妻子", "s": "儿子", "d": "女儿",
        "ob": "哥哥", "yb": "弟弟", "os": "姐姐", "ys": "妹妹",
        "f,f": "爷爷", "f,m": "奶奶", "m,f": "外公", "m,m": "外婆",
        "f,f,f": "曾祖父", "f,f,m": "曾祖母", "f,m,f": "曾外祖父", "f,m,m": "曾外祖母",
        "m,f,f": "外曾祖父", "m,f,m": "外曾祖母", "m,m,f": "外曾外祖父", "m,m,m": "外曾外祖母",
        "f,f,f,f": "高祖父", "f,f,f,m": "高祖母",
        "s,s": "孙子", "s,d": "孙女", "d,s": "外孙", "d,d": "外孙女",
        "s,s,s": "曾孙", "s,s,d": "曾孙女", "d,s,s": "外曾孙", "d,d,s": "外曾孙",
        "d,s,d": "外曾孙女", "d,d,d": "外曾孙女", "s,d,s": "曾外孙", "s,d,d": "曾外孙女",
        "s,s,s,s": "玄孙", "s,s,s,d": "玄孙女",
        # 晚辈配偶、继亲
        "s,w": "儿媳", "d,h": "女婿", "s,s,w": "孙媳妇", "s,d,h": "孙女婿",
        "d,s,w": "外孙媳妇", "d,d,h": "外孙女婿",
        "f,w": "继母", "m,h": "继父", "h,s": "继子", "h,d": "继女", "w,s": "继子", "w,d": "继女",
        # 亲家
        "s,w,f": "亲家公", "s,w,m": "亲家母", "d,h,f": "亲家公", "d,h,m": "亲家母",
    }.items():
        add(chain, term)

    # —— 兄弟姐妹的配偶与子孙 ——
    add("ob,w", "嫂子")
    add("yb,w", "弟媳")
    add("os,h", "姐夫")
    add("ys,h", "妹夫")
    for b in B:
        add(f"{b},s", "侄子"); add(f"{b},d", "侄女")
        add(f"{b},s,w", "侄媳"); add(f"{b},d,h", "侄女婿")
        add(f"{b},s,s", "侄孙"); add(f"{b},s,d", "侄孙女")
        add(f"{b},d,s", "侄外孙"); add(f"{b},d,d", "侄外孙女")
    for z in Z:
        add(f"{z},s", "外甥"); add(f"{z},d", "外甥女")
        add(f"{z},s,w", "外甥媳妇"); add(f"{z},d,h", "外甥女婿")
        add(f"{z},s,s", "外甥孙"); add(f"{z},s,d", "外甥孙女")
        add(f"{z},d,s", "外甥外孙"); add(f"{z},d,d", "外甥外孙女")

    # —— 父系长辈 ——
    add("f,ob", "伯父"); add("f,yb", "叔叔"); add("f,os", "姑妈"); add("f,ys", "姑姑")
    add("f,ob,w", "伯母"); add("f,yb,w", "婶婶")
    for z in Z:
        add(f"f,{z},h", "姑父")
    # —— 母系长辈 ——
    for b in B:
        add(f"m,{b}", "舅舅"); add(f"m,{b},w", "舅妈")
    add("m,os", "姨妈"); add("m,ys", "小姨")
    for z in Z:
        add(f"m,{z},h", "姨父")

    # —— 祖辈的兄弟姐妹 ——
    add("f,f,ob", "伯祖父"); add("f,f,yb", "叔祖父")
    add("f,f,ob,w", "伯祖母"); add("f,f,yb,w", "叔祖母")
    for z in Z:
        add(f"f,f,{z}", "姑奶奶"); add(f"f,f,{z},h", "姑爷爷")
        add(f"f,m,{z}", "姨奶奶"); add(f"f,m,{z},h", "姨爷爷")
        add(f"m,f,{z}", "姑姥姥"); add(f"m,f,{z},h", "姑姥爷")
        add(f"m,m,{z}", "姨姥姥"); add(f"m,m,{z},h", "姨姥爷")
    for b in B:
        add(f"f,m,{b}", "舅爷爷"); add(f"f,m,{b},w", "舅奶奶")
        add(f"m,m,{b}", "舅姥爷"); add(f"m,m,{b},w", "舅姥姥")
    add("m,f,ob", "伯姥爷"); add("m,f,yb", "叔姥爷")
    add("m,f,ob,w", "伯姥姥"); add("m,f,yb,w", "叔姥姥")

    # —— 同辈堂表亲及其配偶、子女 ——
    paternal_tang = [f"f,{b}" for b in B]
    biao = [f"f,{z}" for z in Z] + [f"m,{x}" for x in SIB]
    for p in paternal_tang:
        cousin(p, "堂哥", "堂弟", "堂姐", "堂妹")
    for p in biao:
        cousin(p, "表哥", "表弟", "表姐", "表妹")
    for p, pre in [(p, "堂") for p in paternal_tang] + [(p, "表") for p in biao]:
        add(f"{p},s&o,w", f"{pre}嫂"); add(f"{p},s&y,w", f"{pre}弟媳")
        add(f"{p},d&o,h", f"{pre}姐夫"); add(f"{p},d&y,h", f"{pre}妹夫")
        for oy in OY:
            if pre == "堂":
                add(f"{p},s{oy},s", "堂侄"); add(f"{p},s{oy},d", "堂侄女")
                add(f"{p},d{oy},s", "堂外甥"); add(f"{p},d{oy},d", "堂外甥女")
            else:
                add(f"{p},s{oy},s", "表侄"); add(f"{p},s{oy},d", "表侄女")
                add(f"{p},d{oy},s", "表外甥"); add(f"{p},d{oy},d", "表外甥女")

    # —— 父母的堂表兄弟姐妹 ——
    for b in B:
        cousin(f"f,f,{b}", "堂伯", "堂叔", "堂姑", "堂姑")
        cousin(f"m,f,{b}", "堂舅", "堂舅", "堂姨", "堂姨")
        for oy in OY:  # 再从（第二代堂亲）
            cousin(f"f,f,{b},s{oy}", "从堂哥", "从堂弟", "从堂姐", "从堂妹")
    for z in Z:
        cousin(f"f,f,{z}", "表伯", "表叔", "表姑", "表姑")
        cousin(f"m,f,{z}", "表舅", "表舅", "表姨", "表姨")
    for x in SIB:
        cousin(f"f,m,{x}", "表伯", "表叔", "表姑", "表姑")
        cousin(f"m,m,{x}", "表舅", "表舅", "表姨", "表姨")

    # —— 配偶一方的亲属 ——
    for chain, term in {
        "h,f": "公公", "h,m": "婆婆", "h,ob": "大伯子", "h,yb": "小叔子",
        "h,os": "大姑子", "h,ys": "小姑子", "h,ob,w": "妯娌", "h,yb,w": "妯娌",
        "w,f": "岳父", "w,m": "岳母", "w,ob": "大舅子", "w,yb": "小舅子",
        "w,os": "大姨子", "w,ys": "小姨子", "w,ob,w": "舅嫂", "w,yb,w": "舅弟媳",
        "w,os,h": "连襟", "w,ys,h": "连襟",
        "h,f,f": "祖公公", "h,f,m": "祖婆婆", "w,f,f": "祖岳父", "w,f,m": "祖岳母",
        "s,w,ob": "亲家兄弟", "s,w,yb": "亲家兄弟",
    }.items():
        add(chain, term)
    for b in B:
        add(f"h,{b},s", "侄子"); add(f"h,{b},d", "侄女")
        add(f"w,{b},s", "内侄"); add(f"w,{b},d", "内侄女")
        add(f"h,{b},s,s", "侄孙"); add(f"h,{b},s,d", "侄孙女")
        add(f"w,{b},s,s", "内侄孙"); add(f"w,{b},s,d", "内侄孙女")
    for z in Z:
        add(f"h,{z},s", "外甥"); add(f"h,{z},d", "外甥女")
        add(f"w,{z},s", "内甥"); add(f"w,{z},d", "内甥女")
    # 继亲手足：父/母的配偶的子女
    for chain in ("f,w", "m,h"):
        cousin(chain, "继兄", "继弟", "继姐", "继妹")
    return r


DEFAULT_RULES = build_default_rules()

TOKEN_NAMES = {
    "f": "父亲", "m": "母亲", "p": "父母", "h": "丈夫", "w": "妻子", "sp": "配偶",
    "s": "儿子", "d": "女儿", "c": "子女",
    "ob": "哥哥", "yb": "弟弟", "os": "姐姐", "ys": "妹妹",
    "b": "兄弟", "z": "姐妹", "sib": "兄弟姐妹",
}
