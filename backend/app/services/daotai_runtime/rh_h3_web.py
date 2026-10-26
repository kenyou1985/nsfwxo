#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
H3 长视频生成 Web 控制台（RunningHub）—— 前端 HTML 配套后端服务
================================================================
一键启动:  python3 rh_h3_web.py [端口]   （默认 8765，自动打开浏览器）
浏览器打开: http://127.0.0.1:8765/

功能（覆盖 py 版全部能力）：
  - 全局模式：全局提示词 [Shot N] 自动切分，N 段 N 并发（不限制并发数）
  - 手动分段模式：每段独立提示词（默认 30 段，可增删），每段一路提交、并发生成
  - 5 张参考图上传（工作流节点 28/273/285 用前 3 张，4/5 暂存备用）
  - 像素清晰度档位 0.2/0.3/0.4/0.5、实例类型 default/plus/ultra、单段时长
  - 自杀链免扣费（#443 v4 注入）＋ WS cos_url 直链下载 + /view 抢文件兜底
  - 参考图开头自动检测（PSNR 三档 + 长效应逐档定位）裁头 + ffmpeg 合成（视频末尾一律不裁剪）
  - 每段视频预览、最终视频预览/下载、实时日志
"""
import http.client, json, time, mimetypes, os, sys, ssl, threading, urllib.request
import urllib.parse, re, base64, random as _rnd, subprocess, glob as _g, copy
import types, collections
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import webbrowser

# ---- websocket 依赖兜底（macOS 系统 python3 的 user-site）----
# 注意：3.9 旧 user-site 里是旧版 cv2/numpy（与当前 python3.14 不兼容），只能 append 到末尾兜底 websocket，
# 不能用 insert(0) 抢占，否则 _ref_is_person 会加载旧 cv2 导致人物检测失效
if 'websocket' not in sys.modules:
    _user_sp = os.path.expanduser('~/Library/Python/3.9/lib/python/site-packages')
    if os.path.isdir(_user_sp) and _user_sp not in sys.path:
        sys.path.append(_user_sp)
try:
    import websocket
except ImportError:
    websocket = None

BASE = '/Users/kenyou/Desktop/Ai/nsfwxo/backend/rh_h3_web'
VIDEOS_DIR = os.path.join(BASE, 'videos')            # 产物目录固定 web/videos 下（年月日+8位随机子目录）
IMAGES_DIR = os.path.join(BASE, 'image')             # 图片产物目录固定 web/image 下（年月日+8位随机子目录）
REFS_DIR = os.path.join(BASE, 'refs')
os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(REFS_DIR, exist_ok=True)

# ================= 日志归属（线程局部） =================
_tls = threading.local()

# 服务级日志缓冲（前端运行日志面板在无任务时显示；_emit 无条件写入，重启即清空）
SYS_LOG = collections.deque(maxlen=800)
_SYS_LOG_IDX = 0

def _emit(msg):
    global _SYS_LOG_IDX
    job = getattr(_tls, 'job', None)
    if job is not None:
        job.log(msg)
    else:
        print(msg, flush=True)
    _SYS_LOG_IDX += 1
    SYS_LOG.append((_SYS_LOG_IDX, msg))

# ================= Job 与任务注册表 =================
_JOB_ID_SEQ = 0
_JOB_ID_LOCK = threading.Lock()
class Job:
    def __init__(self, cfg):
        global _JOB_ID_SEQ
        with _JOB_ID_LOCK:
            _JOB_ID_SEQ += 1
            _seq = _JOB_ID_SEQ
        # 毫秒时间戳 + 进程内序号：并发提交时不会拿到同一个 taskId
        self.id = str(int(time.time() * 1000)) + f'{_seq % 1000:03d}'
        self.cfg = cfg
        self.run_dir = os.path.join(VIDEOS_DIR, time.strftime('%Y%m%d') + ''.join(_rnd.choices('0123456789', k=8)))
        os.makedirs(self.run_dir, exist_ok=True)
        self.status = 'submitting'      # submitting / running / trimming / finished / failed / stopped
        self.segments = {}              # seg -> {status, task_id, file, url, error}
        self.logs = []
        self.lock = threading.Lock()
        self.stop_flag = False
        self.thread = None
        self.final_path = None
        self.final_url = None
        self.uploaded = {}              # 参考图本地路径 -> 平台 fileName
        self.wf_json = None
    def log(self, msg):
        with self.lock:
            self.logs.append(msg)
            if len(self.logs) > 4000:
                self.logs = self.logs[-2500:]
    def set_status(self, s):
        with self.lock:
            self.status = s

JOBS = {}
JOBS_LOCK = threading.Lock()
VIDEO_JOB_LOCK = threading.Lock()

# ================= RunningHub 核心（开放 API 通道，改造自 rh_h3_parallel_32并发.py） =================
HOST = 'www.runninghub.ai'
SUICIDE_DELAY = 30
IMG_SUICIDE_DELAY = 60    # 图片自杀链延迟（横屏测试：覆盖487生成耗时，easy sleep 60s 后透传IMAGE）
REF_NODES = ['28', '273', '285']
UPLOAD_LOCK = threading.Lock()   # 多路并发提交时保护参考图上传缓存（job.uploaded），避免 6 路竞态重复上传
# 视频工作流注册表（导演台可下拉自由切换；原版保留不动，只新增）
#   mode='global' 原版：500/501/127/199 + 切分/防旁白逻辑
#   mode='plain'  纯注入版：提示词原样进 prompt_node（如 339），不做切分/改写
#   ref_nodes: 参考图注入节点；delay_nodes: easy sleep 节点；suicide: 自杀 SaveImage 节点
VIDEO_WFS = {
    '2106729712572071938': {'name': '32路并发·动漫文戏二采', 'mode': 'global',
                            'ref_nodes': ['28', '273', '285', '420', '406', '9001', '9002'],
                            'prompt_node': '127', 'delay_nodes': ['438', '441'], 'suicide': '443',
                            'steps_node': '9100', 'output_node': '205'},
    '2106634937741975553': {'name': '动漫文戏·二采', 'mode': 'plain',
                            'ref_nodes': ['326', '327', '328', '329', '330'],
                            'prompt_node': '339', 'delay_nodes': ['438'], 'suicide': '443',
                            'ratio_node': '337', 'steps_node': '289', 'output_node': '214',
                            'output_prefix': 'AI随风二采'},
    '2109528228642050050': {'name': '画布循环·尾帧拼接(v15)', 'mode': 'loop',
                            'ref_nodes': ['28', '273', '285', '420', '406'],
                            'prompt_node': '127', 'delay_nodes': ['441', '438'], 'suicide': '443',
                            'loop_count_node': '1491', 'output_node': '205'},
    '2103746924129071106': {'name': '万能切分·16段(2103746924129071106)', 'mode': 'loop',
                            'ref_nodes': ['28', '273', '285', '420', '406'],
                            'prompt_node': '127', 'delay_nodes': ['438', '441'], 'suicide': '443',
                            'loop_count_node': '1491', 'output_node': '205',
                            'seg_500': True},   # 16段万能切分版：500 全局提示词 + [SEGMENT_N] 提取 + LLM 不唱歌
    # 16段分段输入版（2026-10-13 用户导入，四层嵌套收集 16 槽，平台端实测 16 槽完整保留）：
    #   16 个独立提示词槽（全部 JjkText，字段 text）：
    #     段1-5   = 212/508/509/510/511   → 213.prompt_1~5
    #     段6-10  = 1512/1513/1514/1515/1516 → 512.prompt_1~5
    #     段11-15 = 210/211/1517/1518/1519 → 1521.prompt_1~5
    #     段16    = 1520                    → 1522.prompt_1
    #   收集链：213(5+optional=512) → 512(5+optional=1521) → 1521(5+optional=1522) → 1522(1)
    #   → 213.slot0(LIST 16项) → 222 按 forLoop index 逐槽取 → 127.prompt（平台端 222 已内联 213.slot0）
    #   循环数：505(cond=501, tt=1492=1491-1490, ff=254=213列表长度)；501=false 时走 254（实测待定）
    #   自杀链：440/443 SaveImage（../x*4000 免扣费）+ 438/441 easy sleep 30（保留，禁止删除/绕过）。
    '2109881935799959553': {'name': '16段分段输入·四层嵌套(2109881935799959553·推荐)', 'mode': 'slot16',
                            'ref_nodes': ['28', '273', '285', '420', '406'],
                            'prompt_slots': ['212', '508', '509', '510', '511', '1512', '1513', '1514', '1515', '1516',
                                             '210', '211', '1517', '1518', '1519', '1520'],
                            'slot_fields': ['text'] * 16,
                            'mode_node': '501', 'llm_node': '502', 'llm_value': False,
                            'loop_count_node': '1491', 'output_node': '205',
                            'suicide': ['440', '443'], 'delay_nodes': ['438', '441']},
    # 8段分段输入版 v16（2109548545899601921，用户点名的当前主线，2026-10-13 平台拉取 515 节点确认）：
    #   8 个独立提示词槽（全部 JjkText，字段 text）——原 10 槽版按用户要求改为 8 段：
    #     段1-5  = 212/508/509/510/511 → 213.prompt_1~5
    #     段6-8  = 210/211/6002        → 213.optional_prompt_list=512(210,211,6002,6003,6004) 展开前 3 项
    #   收集链：512(5) → 213(5+optional=512) → 213.slot0(LIST 10项) → 222 按 forLoop index 逐槽取 → 127.prompt
    #   ⚠ 关键（2026-10-13 实测探测铁证）：easy promptList 输出顺序 = prompt_1~5 在前、optional_prompt_list 在后
    #     （此前注释"optional 在前"错误；探测提交 210=AAA/211=BBB 后 LLM2 输出仍只有参考图描述、无任何 AAA/BBB，
    #      且 16 槽版 2109881935799959553 登记顺序同样以 212/508/509/510/511 开头，双证一致）
    #     → 213.prompt_list = [212,508,509,510,511, 210,211,6002,6003,6004]
    #     → 导演台注入槽序必须为 [212,508,509,510,511, 210,211,6002]（前 8 个，与运行时取段顺序一致，防错位）
    #     6003/6004 保留画布空槽，循环 total=8 只取前 8 项，不影响。
    #   循环数：505(cond=501, tt=ff=1492) → 174.total；1492 = 1491 - 1490；1490 默认 0 → 1491=段数
    #   首段衔接：199(第1段预览, prompt=515=513=59 空 CR Prompt Text) → 114 → 191 → 1215 trim 尾帧 → 174.value2/4
    #     （分段模式下 199.prompt 走 59 空文本，首段预览帧可能空/黑；127 主链不受影响，仅影响第1段衔接帧——保留画布原设计）
    #   自杀链：440/443 SaveImage（../x*4000 免扣费）+ 438/441 easy sleep 30（保留，禁止删除/绕过）。
    '2109548545899601921': {'name': '8段分段输入·循环拼接(2109548545899601921·v16)', 'mode': 'slot16',
                            'ref_nodes': ['28', '273', '285', '406', '420'],
                            'prompt_slots': ['212', '508', '509', '510', '511', '210', '211', '6002'],
                            'slot_fields': ['text'] * 8,
                            'mode_node': '501', 'llm_node': '502', 'llm_value': False,
                            'loop_count_node': '1491', 'output_node': '205',
                            'suicide': ['440', '443'], 'delay_nodes': ['438', '441']},
    '2106729712572071938': {'name': '32路并发·动漫文戏二采', 'mode': 'global',
                            'ref_nodes': ['28', '273', '285', '420', '406', '9001', '9002'],
                            'prompt_node': '127', 'delay_nodes': ['438', '441'], 'suicide': '443',
                            'steps_node': '9100', 'output_node': '205'},
    # 16段确定性切分版（2110330160000516098，用户 2026-10-14 重新发布修复版：1351 四级合并链 ≤5 路/级，text7 报错已修）：
    #   500 = JjkText 全局输入（text，完整全局提示词，须含 [Shot 1]..[Shot 2N-1] 锚点，M=2 → 31 分镜 16 段）
    #   501 = PrimitiveBoolean 全局模式（true → 505.tt=504；505.ff=254=1318 列表长度，两分支循环数一致）
    #   502 = PrimitiveBoolean LLM 优化（**对齐画布 → true**：LLM 228 是分段引擎，127.prompt=516.tt=228 LLM 逐段输出 cinematic 描述驱动 H3 音频）
    #   503 = Int 总段数（默认 16，导演台可设 2/4/8…，注入 504(a-1 轮) → 505 → 174.total；段1 走 59/513/199 首段，循环 N-1 轮合并）
    #   确定性切分链：500 → 1335-1342 JjkConcat + 1343-1350 TextFindAndReplace（正则 [SEGMENT_K]）→ 1219 → 514 → 222 → 127.prompt
    #   合并链（四级 ≤5 路，text1-text5 上限）：1305(段1-5) → 1306(段6-10) → 1351(段11-15) → 1307(四路汇合+段16)
    #   参考图：LoadImage 28/273/285/406/420 → 127.ref_image_0-4（199 首段同 LoadImage 链）
    #   时长：159 Int(秒) → 9 帧数公式 → 127.length；25 PrimitiveFloat 0.2（分辨率）；输出 205 SaveVideo（video/ComfyUI）
    #   ⚠ 无 9000/1490/1491/1492/1495 节点（区别于 988/1921 分段输入版）→ 提交不 push 这些
    #   自杀链：440/443 SaveImage（../x*4000 免扣费）+ 438/441 easy sleep 30（保留，禁止删除/绕过）。
    #   2026-10-19 修复（第2轮）：llm_value 仅作后端默认值（True 保持导演台工作台原有 502=true 逻辑不变）。
    #   502 实际取值 = 请求参数 llm 优先（前端开关 / 火宝 llm=false），未传时才用本默认值。
    #   火宝重绘大提示词（4151 字六段式）在 502=true 下 228 必跑 → 228.custom_prompt=202=249+514（切分链完整文本）
    #   拼接膨胀到 24713 tokens > 16384 → Context shift failed 爆窗失败（2112138319926677506）。
    #   显式 llm=false（火宝/前端关 LLM）→ 502=false 干净版(516000)形态：127.prompt=516→514（不吃 228）、
    #   228 仅被 330(PreviewAny) 预览消费 + custom_prompt 强制置空 → 任何提示词长度都不执行 LLM 推理 → 永不爆窗；
    #   H3 音频由提示词自带 overall_soundscape/speaker_mapping 驱动（4路×16段干净版探测已验收音频干净）。
    '2110330160000516098': {'name': '16段确定性切分·全局500输入(2110330160000516098)', 'mode': 'det16',
                            'ref_nodes': ['28', '273', '285', '406', '420'],
                            'prompt_node': '500', 'mode_node': '501', 'llm_node': '502', 'llm_value': False,
                            'loop_count_node': '503', 'output_node': '205',
                            'suicide': ['440', '443'], 'delay_nodes': ['438', '441']},
    # 智能均分·无缝拼接版（2112505169383911425，2026-10-20 用户上传【自带智能均分】，当前主线）：
    #   平台画布自带 4901 统计 [Shot N] 总数 + 1271-1326 锚点 floor((N)*T/S)+1 动态均分（余数归末段）
    #   提交走本地修复版 JSON（canvas_graft_smart_api.json）：三层平台修复（9802 VHS 保存 / 9801 宽高 /
    #   绕过 ImageAddNoise）+ LLM 旁路（删 llama 链 + 502=false + 9800 空兜底，防爆窗）+ 自杀链保留。
    #   自杀链：443 SaveImage（../x*4000 免扣费）+ 438/441 easy sleep（保留，禁止删除/绕过）
    '2112505169383911425': {'name': '智能均分·无缝拼接(2112505169383911425·主线)', 'mode': 'auto16',
                            'ref_nodes': ['28', '273', '285', '406', '420'],
                            'prompt_node': '500', 'loop_count_node': '503',
                            'suicide': '443', 'delay_nodes': ['438'],
                            '_graft_file': os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                        'canvas_graft_smart_api.json')},
}
# 视频比例 UI 值 -> 337 ResolutionSelector 接受的工作流字符串（match=不注入，用工作流默认）
# 注意：337 的合法值列表与本工作流 265 一致，区别于图片工作流 127 的字符串格式
RATIO_MAP = {
    '16:9': '16:9 (Widescreen)',
    '9:16': '9:16 (Portrait Widescreen)',
    '4:3': '4:3 (Standard)',
    '3:4': '3:4 (Portrait Standard)',
    '1:1': '1:1 (Square)',
    '21:9': '21:9 (Ultrawide)',
}



# MiniMax 开放平台官方系统音色（T2A Pro / speech-02-hd / H3 视频配音均可锚定）。
# 中文普通话：青年男 / 中年男 / 青年女 / 中年女；英文：青年男 / 中年男 / 青年女 / 中年老年女。
# -jingpin 后缀为精品 Beta 版，稳定性与自然度更高，推荐优先选用。
VOICE_IDS = {
    'zh': {
        '青年男性': [
            ('male-qn-qingse', '青涩青年音色（干净青涩少年感）'),
            ('male-qn-qingse-jingpin', '青涩青年音色·精品 Beta'),
            ('male-qn-jingying', '精英青年音色（干练职场青年）'),
            ('male-qn-jingying-jingpin', '精英青年音色·精品 Beta'),
            ('male-qn-badao', '霸道青年音色（低沉磁性）'),
            ('male-qn-badao-jingpin', '霸道青年音色·精品 Beta'),
            ('male-qn-daxuesheng', '青年大学生音色（邻家松弛）'),
            ('male-qn-daxuesheng-jingpin', '青年大学生音色·精品 Beta'),
        ],
        '中年男性': [
            ('presenter_male', '男性主持人（标准播音腔，纪录片/宣传片）'),
            ('audiobook_male_1', '男性有声书 1（醇厚中年男声，故事叙事首选）'),
            ('audiobook_male_2', '男性有声书 2（厚重沉稳，偏严肃纪实）'),
        ],
        '青年女性': [
            ('female-shaonv', '少女音色（清甜活泼）'),
            ('female-shaonv-jingpin', '少女音色·精品 Beta'),
            ('female-tianmei', '甜美女性音色（温柔甜妹，短视频解说）'),
            ('female-tianmei-jingpin', '甜美女性音色·精品 Beta'),
            ('female-yujie', '御姐音色（低哑冷静有气场）'),
            ('female-yujie-jingpin', '御姐音色·精品 Beta'),
        ],
        '中年女性': [
            ('female-chengshu', '成熟女性音色（知性中年女性，温和理性）'),
            ('female-chengshu-jingpin', '成熟女性音色·精品 Beta'),
            ('presenter_female', '女性主持人（标准播音女声，新闻/专题）'),
            ('audiobook_female_1', '女性有声书 1（柔和叙事，情感向有声）'),
            ('audiobook_female_2', '女性有声书 2（端庄稳重，长篇读物）'),
        ],
    },
    'en': {
        '年轻男性': [
            ('English_Expressive_Narrator', 'Expressive Narrator（美音，青年叙事男声）'),
            ('English_Magnetic_voiced_man', 'Magnetic-voiced Man（美音，磁性青年男）'),
            ('English_Gentle-voiced_man', 'Gentle-voiced Man（美音，温柔青年男声）'),
            ('English_Trustworth_Man', 'Trustworthy Man（美音，可靠青年男声）'),
            ('English_Diligent_Man', 'Diligent Man（印度英语，清晰青年男）'),
        ],
        '中年男性': [
            ('English_Aussie_Bloke', 'Aussie Bloke（澳音，中年沙哑自然男声）'),
        ],
        '年轻女性': [
            ('English_radiant_girl', 'Radiant Girl（美音，元气少女）'),
            ('English_Whispering_girl', 'Whispering girl（美音，轻语少女）'),
            ('English_Upbeat_Woman', 'Upbeat Woman（美音，开朗年轻女性）'),
            ('English_Captivating_female1', 'Captivating Female（美音，明亮热情女声）'),
        ],
        '中年/老年女性': [
            ('English_compelling_lady1', 'Compelling Lady（美音，知性中年女性）'),
            ('English_CalmWoman', 'Calm Woman（美音，从容稳重中年女声）'),
            ('English_Graceful_Lady', 'Graceful Lady（英音，优雅成熟女士）'),
        ],
    },
}

def _conn():
    return http.client.HTTPSConnection(HOST, timeout=60)

def upload_file(job, path):
    api_key = job.cfg['api_key']
    boundary = '----RH' + str(int(time.time()))
    body = b''
    def field(name, val):
        nonlocal body
        body += ('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, name, val)).encode()
    def filefield(name, fname, content):
        nonlocal body
        ctype = mimetypes.guess_type(fname)[0] or 'application/octet-stream'
        body += ('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\nContent-Type: %s\r\n\r\n'
                 % (boundary, name, fname, ctype)).encode() + content + b'\r\n'
    field('apiKey', api_key)
    field('fileType', 'input')
    filefield('file', os.path.basename(path), open(path, 'rb').read())
    body += ('--%s--\r\n' % boundary).encode()
    last = None
    for attempt in range(1, 4):
        try:
            conn = _conn()
            conn.request('POST', '/task/openapi/upload', body,
                         {'Host': HOST, 'Content-Type': 'multipart/form-data; boundary=' + boundary})
            r = json.loads(conn.getresponse().read().decode())
            if r.get('code') != 0:
                raise RuntimeError('上传失败: ' + json.dumps(r))
            return r['data']['fileName']
        except Exception as e:
            last = e
            _emit('  上传连接中断(%s)，%d 秒后重试 (第%d/3次)...' % (e, 3 * attempt, attempt))
            time.sleep(3 * attempt)
    raise RuntimeError('上传失败（重试3次仍失败）: %s' % last)

def load_wf(job):
    api_key, wid = job.cfg['api_key'], job.cfg['workflow_id']
    try:
        conn = _conn()
        payload = json.dumps({'apiKey': api_key, 'workflowId': wid})
        conn.request('POST', '/api/openapi/getJsonApiFormat', payload,
                     {'Host': HOST, 'Content-Type': 'application/json'})
        j = json.loads(conn.getresponse().read().decode())
        if j.get('code') == 0 and j.get('data', {}).get('prompt'):
            _p = j['data']['prompt']
            wf = json.loads(_p) if isinstance(_p, str) else _p
            _emit('已从平台拉取工作流 %s 的 API JSON（%d 节点）' % (wid, len(wf)))
            return wf
        _emit('平台拉取失败: %s' % json.dumps(j)[:200])
    except Exception as e:
        _emit('平台拉取异常(%s)' % e)
    return None


def inject_purification_nodes(wf):
    """H3 Prompt 净化节点链（2026-10-21）：
    插入两路 Text Find and Replace → 去除「话音刚落」「等他说完」等过渡连接词、
    去除 (S1): 等旁白标记、去除「发颤道」类动作说描写。
    auto16 路径：514→1500→1510→1520→127.prompt
    全局路径：513→1501→1511→1521→199.prompt
    """
    if not wf:
        return wf
    try:
        PURIFY_NODES = {
            '1500': {
                'class_type': 'Text Find and Replace',
                'inputs': {'find': ['1502', 0], 'replace': '', 'text': ['516', 0]},
                '_meta': {'title': 'H3 Prompt净化①-过渡词'}
            },
            '1501': {
                'class_type': 'Text Find and Replace',
                'inputs': {'find': ['1503', 0], 'replace': '', 'text': ['515', 0]},
                '_meta': {'title': 'H3 Prompt净化①-过渡词'}
            },
            '1502': {
                'class_type': 'JjkText',
                'inputs': {'text': r'话音刚落[,，]|等他说完[,，]|等他问完[,，]|她说完后[,，]|她话音刚落[,，]|紧接着[,，]|随后[,，]|他话音刚落[,，]'},
                '_meta': {'title': '净化①-过渡词regex'}
            },
            '1503': {
                'class_type': 'JjkText',
                'inputs': {'text': r'话音刚落[,，]|等他说完[,，]|等他问完[,，]|她说完后[,，]|她话音刚落[,，]|紧接着[,，]|随后[,，]|他话音刚落[,，]'},
                '_meta': {'title': '净化①-过渡词regex'}
            },
            '1510': {
                'class_type': 'Text Find and Replace',
                'inputs': {'find': ['1512', 0], 'replace': ' ', 'text': ['1500', 0]},
                '_meta': {'title': 'H3 Prompt净化②-去旁白'}
            },
            '1511': {
                'class_type': 'Text Find and Replace',
                'inputs': {'find': ['1513', 0], 'replace': ' ', 'text': ['1501', 0]},
                '_meta': {'title': 'H3 Prompt净化②-去旁白'}
            },
            '1512': {
                'class_type': 'JjkText',
                'inputs': {'text': r'\s*\([S\d]+\)[:：]\s*'},
                '_meta': {'title': '净化②-去旁白regex'}
            },
            '1513': {
                'class_type': 'JjkText',
                'inputs': {'text': r'\s*\([S\d]+\)[:：]\s*'},
                '_meta': {'title': '净化②-去旁白regex'}
            },
            '1520': {
                'class_type': 'Text Find and Replace',
                'inputs': {'find': ['1522', 0], 'replace': '', 'text': ['1510', 0]},
                '_meta': {'title': 'H3 Prompt净化③-动+说'}
            },
            '1521': {
                'class_type': 'Text Find and Replace',
                'inputs': {'find': ['1523', 0], 'replace': '', 'text': ['1511', 0]},
                '_meta': {'title': 'H3 Prompt净化③-动+说'}
            },
            '1522': {
                'class_type': 'JjkText',
                'inputs': {'text': r'[，。、；][^<。\n]{0,100}?(?:说|问|喊|道|声道|颤声|低声|冷声|喃喃|厉声)[：:][^<]*?(?=\s*\(S\d+\):)'},
                '_meta': {'title': '净化③-动+说regex'}
            },
            '1523': {
                'class_type': 'JjkText',
                'inputs': {'text': r'[，。、；][^<。\n]{0,100}?(?:说|问|喊|道|声道|颤声|低声|冷声|喃喃|厉声)[：:][^<]*?(?=\s*\(S\d+\):)'},
                '_meta': {'title': '净化③-动+说regex'}
            },
        }
        for nid, ndata in PURIFY_NODES.items():
            wf[nid] = ndata
        # Reroute H3 prompt inputs through purifier chain
        if '127' in wf and 'prompt' in wf['127'].get('inputs', {}):
            wf['127']['inputs']['prompt'] = ['1520', 0]
        if '199' in wf and 'prompt' in wf['199'].get('inputs', {}):
            wf['199']['inputs']['prompt'] = ['1521', 0]
        _emit('  ★ 注入 H3 Prompt 净化节点链（12 节点）：过渡词→旁白→动+说')
    except Exception as e:
        _emit('  ⚠ H3 Prompt 净化注入失败（%s），继续不净化' % e)
    return wf


def _cover_ref_to_ratio(src_path, ratio):
    """把参考图按目标比例居中裁切（cover）：等比放大填满目标画布后裁掉溢出边缘，无模糊填充。
    用于视频参考图比例适配：横屏参考图适配竖屏输出时保留主体居中区域，
    避免平台/工作流对比例不匹配的参考图做上下模糊填充画布。失败返回 None。"""
    dims = {'16:9': (960, 540), '9:16': (540, 960), '4:3': (720, 540), '3:4': (540, 720),
            '1:1': (640, 640), '21:9': (1260, 540), '9:21': (540, 1260)}
    if ratio not in dims:
        return None
    W, H = dims[ratio]
    out = os.path.join(os.path.dirname(src_path), 'ref1_cover_%s.png' % ratio.replace(':', 'x'))
    vf = 'scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d' % (W, H, W, H)
    try:
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src_path,
                            '-vf', vf, out], capture_output=True, text=True, timeout=120)
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 5000:
            return out
    except Exception as e:
        _emit('  参考图预处理异常(%s)' % e)
    return None

def h3_frames(seconds):
    f = max(5, round(seconds * 24))
    return f + (5 - f % 17) % 17

# ===== 智能分镜检测（v2）：限定 detailed_description 范围 + 多模式 =====
_BRACKET_SHOT = [
    r'\[\s*Shot\s*\d+\s*\]',   # [Shot 1]
    r'\[\s*分镜\s*\d+\s*\]',   # [分镜 1]
    r'\[\s*镜头\s*\d+\s*\]',   # [镜头 1]
]
_LINE_SHOT = r'(?m)^\s*(?:Shot|SHOT|分镜|镜头)\s*\d+\b'  # 行首：Shot 1 / 分镜1 / 镜头1

def _extract_desc_zone(prompt):
    """提取分镜区：(全局描述 head, 分镜区 zone)。
    优先取 detailed_description 标签之后、overall_soundscape 之前的内容；
    无标签则 head=全文、zone=''（调用方回退全文检测）。"""
    if not prompt:
        return '', ''
    m = re.search(r'(?:detailed_description|详细画面描述)\s*[:：]', prompt, re.I)
    if not m:
        return prompt.strip(), ''
    head = prompt[:m.start()].strip()
    rest = prompt[m.end():]
    m2 = re.search(r'(?:overall_soundscape|整体音效|soundscape)\s*[:：]', rest, re.I)
    zone = rest[:m2.start()] if m2 else rest
    return head, zone.strip()

def _best_shot_pattern(zone):
    """选出 zone 内出现次数最多的分镜标记模式（括号/行首统一比较，取最大）。"""
    best, best_n = None, 0
    for p in _BRACKET_SHOT:
        n = len(re.findall(p, zone))
        if n > best_n:
            best, best_n = p, n
    n = len(re.findall(_LINE_SHOT, zone))
    if n > best_n:
        best, best_n = _LINE_SHOT, n
    return best, best_n

def _split_zone_shots(zone):
    """分镜区 → 分镜列表（四级级联）。返回 (shots, pat, lead)。

    级联顺序（count_shots / _seg_text_list_full 共用同一实现，杜绝各处切法漂移）：
      ① [Shot N] / [分镜 N] / [镜头 N] 括号标记，或行首 `Shot N`
      ② 行首时间戳 `At 00:04.000` / `00:04` —— 火宝六段式提示词没有 [Shot N]，靠这一级切
      ③ 空行分段
      ④ 单块兜底：整个分镜区视为一个分镜
    pat 非 None 表示走的是 ①，lead = 标记前导文本（parts[0]）。
    """
    pat, _n = _best_shot_pattern(zone)
    if pat:
        parts = re.split(pat, zone)
        return [x.strip() for x in parts[1:] if x.strip()], pat, parts[0].strip()
    ts = [x.strip() for x in re.split(r'(?m)(?=At\s*\d{1,2}[:.]\d|(?<=\n)\s*\d{1,2}[:.]\d{2})', zone) if x.strip()]
    if len(ts) >= 2:
        return ts, None, ''
    blocks = [b.strip() for b in re.split(r'\n\s*\n', zone) if b.strip()]
    if len(blocks) >= 2:
        return blocks, None, ''
    return [zone], None, ''


def _split_shots(prompt):
    """智能分镜切分：返回 (全局描述, 分镜列表)。"""
    head, zone = _extract_desc_zone(prompt)
    if not zone:
        head, zone = '', prompt.strip()   # 无 detailed_description 标签 → 全文检测
    shots, pat, lead = _split_zone_shots(zone)
    # 1) 带分镜标记模式
    if pat:
        return (head or lead or prompt[:200]), shots
    return head, shots

def count_shots(prompt):
    _h, shots = _split_shots(prompt or '')
    return len(shots)

def _seg_text_global(global_prompt, lo, hi, dur=None):
    """按分镜区间 [lo, hi] 切分；每段只返回该区间分镜文本 + 仅本段涉及的角色定义。
    每段分镜数 > 1 时（shots_per_seg），同一段包含连续多个 [Shot]，角色定义只提取该段出现的角色。
    为本段分镜补时间戳（按段时长均分），驱动模型按时间轴推进，防动作循环重复。"""
    head, shots = _split_shots(global_prompt)
    n = len(shots)
    if n == 0:
        return global_prompt.strip()
    lo = max(1, int(lo))
    hi = min(n, int(hi))
    if lo > hi:
        lo = hi
    mine = shots[lo - 1:hi]
    k = len(mine)
    if dur is None:
        dur = max(15, k * 5)          # 单分镜 15s；多分镜每分镜 5s 紧凑推进
    per = dur / float(k)              # 每分镜秒数
    body_lines = []
    for i, s in enumerate(mine):
        # 每段视频独立生成 15s，原提示词时间线（At 00:21/00:28…）与真实时长不匹配会误导模型
        # 提交时清洗全部时间戳，只保留分镜文本内容；分镜顺序由 [Shot N] 标记 + 换行体现
        s = re.sub(r'At\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s, flags=re.I)          # At 前缀时间戳
        s = re.sub(r'(?<=[，,、（(])\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)        # 标点后的裸时间戳
        s = re.sub(r'^\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)                      # 行首裸时间戳
        s = re.sub(r'[，,、]+\s*', '，', s).strip(' ，,、')
        # 台词行截断：<d>...</d> 后强制换行，避免 H3 把台词后的动作描述/英文 lip 指令当台词续读
        s = s.replace('</d>', '</d>\n').strip('\n')
        body_lines.append('[Shot %d] %s' % (lo + i, s))
    body = '\n'.join(body_lines)
    roles = sorted({m.group(1) for m in re.finditer(r'<Subject\s+(\d+)>', body)})
    defs = []
    for r in roles:
        # 优先匹配定义句（<Subject N> 是...），跳过 <Picture 1> 引用句里的 <Subject N>
        m = re.search(r'<Subject\s+%s>\s*是(.*?)(?=\s*<Subject\s+\d+>\s*是|$)' % r, head, re.S)
        if not m:
            m = re.search(r'<Subject\s+%s>(.*?)(?=\s*<Subject\s+\d+>|$)' % r, head, re.S)
        if m:
            defs.append('<Subject %s>是%s' % (r, m.group(1).strip()))
    if defs:
        out = ('本段角色定义（仅以下角色出现于本段镜头，未列出的角色不得出现在画面中）:\n'
               + '\n'.join(defs) + '\n\n' + body)
    else:
        out = body
    # 附加 speaker_mapping：H3 模型依据 Sx→音色映射选择音色，缺省会回退默认音色（如少女音）。
    # （speaker_mapping 仅含映射无叙事文本，summary 已摘除，不会引发旁白朗读。）
    _sm = re.search(r'\n*\s*speaker_mapping\s*:.*$', global_prompt, re.I | re.S)
    if _sm and 'speaker_mapping' not in out:
        out = out + '\n\n' + _sm.group(0).strip()
    return out

def _strip_narration(text):
    """摘除会被 H3 TTS 朗读成旁白的内容（无论切分开关状态均应用）：
    - summary 叙事区（剧情概述，无 [Shot] 包裹 → H3 当旁白朗读）
    - [reference generation] 标记（Ref2VA 参考图扩展触发标记 → 诱导读 summary）
    保留 subject_definitions / retention_analysis / overall_soundscape / non_diegetic_music / speaker_mapping 等标签原样。
    注意：speaker_mapping 必须保留 —— H3 模型依据它把 Sx 映射到具体音色；摘除会导致音色回退默认（少女音）。
    （summary 摘除后，speaker_mapping 仅含 Sx→音色映射，无叙事文本，不会引发旁白。）"""
    if not text:
        return text
    t = re.sub(r'\[reference\s+generation\]\s*', '', text, flags=re.I)
    t = re.sub(r'\n*\s*summary\s*:.*?(?=\n\s*(?:retention_analysis|retention\b|subject_definitions|detailed_description|overall_soundscape|soundscape\b|non_diegetic_music|speaker_mapping)\s*[:：])',
               '\n', t, flags=re.I | re.S)
    t = re.sub(r'\n*\s*summary\s*:.*$', '\n', t, flags=re.I | re.S)
    return t.strip()

def _seg_text_global_full(prompt, lo, hi, dur=None):
    """全局提示词切分（保留完整标签版）：保留 subject_definitions / summary / retention_analysis /
    overall_soundscape / non_diegetic_music 等全部标签原样，只把 detailed_description 的分镜区替换为本段 shots。"""
    head, zone = _extract_desc_zone(prompt)
    if not zone:
        # 无 detailed_description 标签（或标签缺失）→ 回退全文切分（与 _split_shots 一致），
        # 否则整段返回完整提示词会导致「每段开头剧情相同」。
        head, zone = '', prompt.strip()
    if not zone:
        return prompt.strip()
    # 提取 overall_soundscape 及之后的标签块（原样保留）
    _m = re.search(r'(?:detailed_description|详细画面描述)\s*[:：]', prompt, re.I)
    _rest = prompt[_m.end():] if _m else ''
    _m2 = re.search(r'(?:overall_soundscape|整体音效|soundscape)\s*[:：]', _rest, re.I)
    after = _rest[_m2.start():].strip() if _m2 else ''
    # speaker_mapping 保留：H3 模型依据 Sx→音色映射选择音色；摘除会回退默认音色。
    # （summary 已在 tags/body 摘除，speaker_mapping 仅含映射无叙事，不会引发旁白）
    # 分镜切分（复用智能切分）
    pat, _n = _best_shot_pattern(zone)
    if pat:
        parts = re.split(pat, zone)
        shots = [x.strip() for x in parts[1:] if x.strip()]
    else:
        blocks = [b.strip() for b in re.split(r'\n\s*\n', zone) if b.strip()]
        shots = blocks or [zone]
    n = len(shots)
    if n == 0:
        return prompt.strip()
    lo = max(1, int(lo))
    hi = min(n, int(hi))
    if lo > hi:
        lo = hi
    mine = shots[lo - 1:hi]
    k = len(mine)
    if dur is None:
        dur = max(15, k * 5)
    body_lines = []
    for i, s in enumerate(mine):
        s = re.sub(r'At\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s, flags=re.I)
        s = re.sub(r'(?<=[，,、（(])\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)
        s = re.sub(r'^\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)
        s = re.sub(r'[，,、]+\s*', '，', s).strip(' ，,、')
        # 台词行截断：<d>...</d> 后强制换行，避免 H3 把台词后的动作描述/英文 lip 指令当台词续读
        s = s.replace('</d>', '</d>\n').strip('\n')
        body_lines.append('[Shot %d] %s' % (lo + i, s))
    body = '\n'.join(body_lines)
    tags = head
    if 'detailed_description' not in tags.lower() and '详细画面描述' not in tags:
        tags += '\n\ndetailed_description:'
    # 移除 [reference generation] 标记：这是 H3 Ref2VA 的"参考图扩展"触发标记，
    # 模型读到它会进入扩展生成模式，把后续 summary 文本当"要生成并讲述的内容"→ 被 TTS 朗读（且触发双段生成画面重复）
    tags = re.sub(r'\[reference\s+generation\]\s*', '', tags, flags=re.I)
    # 摘除 summary 叙事区：H3 会把无 [Shot] 包裹的剧情叙事文本当旁白朗读
    # （已实测：移除标记 + 移除 speaker_mapping 后 summary 仍被读）→ summary 仅在 500 全局提示词保留，127 段文本不再携带
    tags = re.sub(r'\n*\s*summary\s*:.*?(?=\n\s*(?:retention_analysis|retention\b|subject_definitions|detailed_description|overall_soundscape|soundscape\b|non_diegetic_music|speaker_mapping)\s*[:：])', '\n', tags, flags=re.I | re.S)
    tags = re.sub(r'\n*\s*summary\s*:.*$', '\n', tags, flags=re.I | re.S)
    out = (tags + '\n' + body + ('\n\n' + after if after else '')).strip()
    # 保留 speaker_mapping（音色映射）：H3 模型依据 Sx→音色选择配音音色，
    # 摘除会回退默认音色（实测少女音）；summary 已摘除，此处仅含映射不会引发旁白
    _m_sm = re.search(r'\n*\s*speaker_mapping\s*:.*$', prompt, flags=re.I | re.S)
    if _m_sm:
        _sm_part = _m_sm.group(0).strip()
        if _sm_part and _sm_part not in out:
            out = (out + '\n\n' + _sm_part).strip()
    return out

def _guard_shot_anchors(text):
    """画布确定性切分链防护（2026-10-21）：
    det16 工作流（2110330160000516098 等）内部 1290-1350 用
    `[\\s\\S]*(\\[Shot N\\][\\s\\S]*?)(\\[Shot K\\][\\s\\S]*)?$` 全文贪婪匹配定位分镜锚点；
    retention_analysis / summary 等 detailed_description 前置段里的行内 `[Shot N]`
    （如 "(appears in [Shot 1], [Shot 2]...)"）会抢占锚点 → 切分段文本错位 → H3 音频污染
    （乱入台词/旁白错乱/台词重复）。本函数仅把 detailed_description 之前的行内 `[Shot N]`
    改写为 `(Shot N)`（圆括号不被 `\\[Shot` 匹配），行首锚点（detailed_description 每镜独占一行）不受影响。"""
    if not text:
        return text
    m = re.search(r'(?m)^\s*detailed_description\s*[:：]', text)
    if not m:
        return text
    head, body = text[:m.start()], text[m.start():]
    _new = re.sub(r'\[Shot\s+(\d+)\]', r'(Shot \1)', head)
    return (_new + body) if _new != head else text


def _seg_text_det16(prompt, lo, hi):
    """det16 多路并发的每路全局提示词（API 接入专用）：
    保留 subject_definitions / overall_soundscape / non_diegetic_music / speaker_mapping 等标签原样，
    只把 detailed_description 分镜区替换为本路分镜，且**分镜号重排从 [Shot 1] 开始**——
    工作流切分正则按 [Shot 1]..[Shot N*M-1] 边界匹配，路内分镜号必须连续，否则正则匹配不到产生空段。"""
    head, zone = _extract_desc_zone(prompt)
    if not zone:
        head, zone = '', prompt.strip()
    _m = re.search(r'(?:detailed_description|详细画面描述)\s*[:：]', prompt, re.I)
    _rest = prompt[_m.end():] if _m else ''
    _m2 = re.search(r'(?:overall_soundscape|整体音效|soundscape)\s*[:：]', _rest, re.I)
    after = _rest[_m2.start():].strip() if _m2 else ''
    pat, _n = _best_shot_pattern(zone)
    if pat:
        parts = re.split(pat, zone)
        shots = [x.strip() for x in parts[1:] if x.strip()]
    else:
        # 2026-10-21：与 _split_shots 同源（火宝六段式无 [Shot N]，靠时间戳级联切分）
        shots, _pat2, _lead2 = _split_zone_shots(zone)
    n = len(shots)
    if n == 0:
        return prompt.strip()
    lo = max(1, int(lo))
    hi = min(n, int(hi))
    if lo > hi:
        lo = hi
    mine = shots[lo - 1:hi]
    body_lines = []
    for i, s in enumerate(mine):
        s = re.sub(r'At\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s, flags=re.I)
        s = re.sub(r'(?<=[，,、（(])\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)
        s = re.sub(r'^\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)
        s = re.sub(r'[，,、]+\s*', '，', s).strip(' ，,、')
        s = s.replace('</d>', '</d>\n').strip('\n')
        body_lines.append('[Shot %d] %s' % (i + 1, s))   # 分镜号重排：从 1 开始（画布切分正则锚点）
    body = '\n'.join(body_lines)
    tags = head
    if 'detailed_description' not in tags.lower() and '详细画面描述' not in tags:
        tags += '\n\ndetailed_description:'
    tags = re.sub(r'\[reference\s+generation\]\s*', '', tags, flags=re.I)
    # v7：完整官方 6 段式（用户要求"每一段提交的提示词都是官方的 6 段式提示词"）：
    #   subject_definitions / summary / retention_analysis / detailed_description /
    #   overall_soundscape / non_diegetic_music（+ speaker_mapping 音色映射）。
    # v6 剔除声音段后每段只剩 4 段结构 → H3 自由发挥生成"莫名旁白/怪对白/画面崩"（用户当前反馈
    # "第二段起对白不自然+莫名其妙旁白+画面崩"）。音乐问题不再用"删段"解决，而是把
    # non_diegetic_music 显式置 None（无背景音乐/无旁白/无唱歌），声音段保留真实人声/环境声描述。
    # v12（2026-10-15）：强化指令，把"无音乐/无旁白/无说话声"作为 **硬性约束**写在每段提示词头部，
    # 防止 LLM 228 把整体提示词改写成"cinematic 配乐"版本。
    _sc = re.search(r'overall_soundscape\s*[:：]\s*(.*?)(?=\n\s*(?:non_diegetic_music|speaker_mapping)\s*[:：]|\Z)', prompt, re.I | re.S)
    _sm2 = re.search(r'speaker_mapping\s*[:：].*$', prompt, re.I | re.S)
    _out = (tags + '\n' + body).strip()
    if _sc and _sc.group(1).strip():
        _out += '\n\noverall_soundscape: ' + _sc.group(1).strip()
    # v12 强化版：4 条硬性约束，禁止任何形式的音乐/旁白/合成人声（v11 的简短版被 LLM 覆盖）
    _out += '\n\n=== AUDIO CONSTRAINTS (HARD RULES, MUST FOLLOW) ==='
    _out += '\n1. NO background music, NO BGM, NO soundtrack, NO cinematic score, NO instrumental — ABSOLUTELY ZERO music in the final audio.'
    _out += '\n2. NO narration, NO voice-over, NO commentary, NO inner monologue — characters do not speak to the audience.'
    _out += '\n3. NO singing, NO humming, NO vocal melody, NO synthesized vocal tracks, NO choir, NO vocals of any kind.'
    _out += '\n4. Audio must be diegetic ONLY — only sounds that exist within the scene world (footsteps, wind, objects, character grunts/breathing if natural).'
    _out += '\n=== END AUDIO CONSTRAINTS ==='
    _out += '\n\nnon_diegetic_music: None. No background music, no narration, no singing, no extra vocal tracks; only the natural sounds described in overall_soundscape.'
    if _sm2 and _sm2.group(0).strip():
        _out += '\n\n' + _sm2.group(0).strip()
    return _out
def _seg_text_list_full(prompt, lo, hi, n_segs=2):
    """det16 v11 全局修复版：每路 N 段的纯净提示词（绕开画布切分链，直接注入 199/1318 节点）——

    全局修复（2026-10-15 用户反馈"第 4 段起音乐/画面乱"的根因修复）：

    根因：画布 mark chain → JjkConcat → TextFindAndReplace 提取链极度脆弱——
    mark 正则 只捕获 [Shot S1]...[Shot S2]（约 2 分镜），其余内容全部丢失；
    1306/1351/1304 的无效 mark chain 输出原始文本复制（因无对应 [Shot N] 标记）；
    提取链的掐头/去尾正则对重复文本的 [SEGMENT_N] 定位错位 → 中间 segments 混入其他 segments 内容。

    修复 v11（全局最优解）：绕过提取链，直接注入预格式化的 per-segment 提示词。

    每段 = subject_definitions + summary + retention_analysis + detailed_description（该段分镜，重排编号）
              + overall_soundscape（全局原样）+ non_diegetic_music: None + speaker_mapping（全局原样）。

    适用任意路数/任意段数：8路×2段/4路×4段/2路×8段/单路×16段。

    注入方案（零新增节点）：
      ① 199.prompt = 段1 文本（直连注入，不走 515/1225 提取链）
      ② forLoop iter i → 222 → 1318(prompt_{i+1}) → 222.i=174[1]=loop_index
         1318.prompt_1=1313(段2), _2=1314(段3), _3=1315(段4), _4=1316(段5), _5=1317(段6)
         1318.optional_prompt_list=213 → 213.prompt_1=510(段7), _2=511(段8), _3=1310(段9), _4=1311(段10), _5=1312(段11)
         213.optional_prompt_list=512 → 512.prompt_1=210(段12), _2=211(段13), _3=212(段14), _4=508(段15), _5=509(段16)
      ③ 每段均含 non_diegetic_music: None（H3 背景音乐/唱歌污染的根因修复）
    """
    head, zone = _extract_desc_zone(prompt)
    if not zone:
        head, zone = '', prompt.strip()
    _m = re.search(r'(?:detailed_description|详细画面描述)\s*[:：]', prompt, re.I)
    _rest = prompt[_m.end():] if _m else ''
    _m2 = re.search(r'(?:overall_soundscape|整体音效|soundscape)\s*[:：]', _rest, re.I)
    after = _rest[_m2.start():].strip() if _m2 else ''
    pat, _n = _best_shot_pattern(zone)
    if pat:
        parts = re.split(pat, zone)
        shots = [x.strip() for x in parts[1:] if x.strip()]
    else:
        # ===== 2026-10-21 火宝多段重复修复：与 _split_shots 统一走同一套级联 =====
        # 旧逻辑只认 [Shot N] 括号标记；火宝六段式提示词没有 [Shot N]（前端 stripShotMarkers
        # 已剥离），于是这里退化成「空行分段」→ detailed_description 整块 = 1 个分镜
        # → n_segs=2 时 mine 只有 1 块 → 段2 = 段1（下面 segs.append(segs[-1]) 补位）
        # → 两段视频提示词逐字相同 → 拼接后画面重复。
        # _split_shots 有 ②时间戳 级联（At 00:04.000），count_shots 因此能数出 3 个分镜；
        # 这里必须同源，否则「按分镜数定段数」与「按分镜切段」对不上。
        shots, _pat2, _lead2 = _split_zone_shots(zone)
    n = len(shots)
    if n == 0:
        return [prompt.strip()] * max(1, int(n_segs))
    lo = max(1, int(lo))
    hi = min(n, int(hi))
    if lo > hi:
        lo = hi
    mine = shots[lo - 1:hi]
    def _clean(s):
        s = re.sub(r'At\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s, flags=re.I)
        s = re.sub(r'(?<=[，,、（(])\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)
        s = re.sub(r'^\s*\d{1,2}[:.]\d{2}(?:\.\d+)?', '', s)
        s = re.sub(r'[，,、]+\s*', '，', s).strip(' ，,、')
        s = s.replace('</d>', '</d>\n').strip('\n')
        return s
    tags = head
    if 'detailed_description' not in tags.lower() and '详细画面描述' not in tags:
        tags += '\n\ndetailed_description:'
    tags = re.sub(r'\[reference\s+generation\]\s*', '', tags, flags=re.I)
    # 提取 speaker_mapping（保留角色声线绑定）
    _sm_full = re.search(r'speaker_mapping\s*[:：].*$', prompt, re.I | re.S)
    _sm_text = _sm_full.group(0).strip() if _sm_full else ''
    def _seg_one(idx0, idx1):
        _seg_tags = tags
        _seg_shots = []
        for i, j in enumerate(range(idx0, min(idx1, len(mine)))):
            _body = _clean(mine[j])
            if idx0 > 0:
                # 续段必须从上一段尾帧的裸体状态开始，禁止把参考图初始穿着当成新开头
                _body = 'She is already completely nude from the previous segment; no clothing remains. ' + _body
            _seg_shots.append('[Shot %d] %s' % (i + 1, _body))
        _b = '\n'.join(_seg_shots)
        if idx0 > 0:
            # 段2+ 的 head 不能继续携带全局“从穿着开始”的 summary / 服装说明
            _seg_tags = re.sub(
                r'(?is)(summary\s*[:：]).*?(?=\n\s*(?:retention_analysis|详细画面描述)\s*[:：])',
                r'\1\n[video continuation] This segment continues directly from <Picture_Last>. '
                r'The woman is already completely nude; no clothing returns; do not restart, do not undress, do not return to the opening outfit.',
                _seg_tags,
                count=1,
            )
            _seg_tags = re.sub(
                r'(?i)Clothing applies only to Shot 1[^\n]*',
                'She is already completely nude from the previous segment; clothing never resets; no bra, no panties, no fabric.',
                _seg_tags,
                count=1,
            )
        _out = (_seg_tags + '\n' + _b).strip()
        if after:
            # 只保留 overall_soundscape，丢弃用户原始 non_diegetic_music（会被硬约束覆盖）
            _sc_m = re.search(r'overall_soundscape\s*[:：]\s*(.*?)(?=\n\s*(?:non_diegetic_music|speaker_mapping)\s*[:：]|\Z)', after, re.I | re.S)
            if _sc_m and _sc_m.group(1).strip():
                _out += '\n\noverall_soundscape: ' + _sc_m.group(1).strip()
        # v12 强化版：4 条硬性约束，禁止任何形式的音乐/旁白/合成人声
        _out += '\n\n=== AUDIO CONSTRAINTS (HARD RULES, MUST FOLLOW) ==='
        _out += '\n1. NO background music, NO BGM, NO soundtrack, NO cinematic score, NO instrumental — ABSOLUTELY ZERO music in the final audio.'
        _out += '\n2. NO narration, NO voice-over, NO commentary, NO inner monologue — characters do not speak to the audience.'
        _out += '\n3. NO singing, NO humming, NO vocal melody, NO synthesized vocal tracks, NO choir, NO vocals of any kind.'
        _out += '\n4. Audio must be diegetic ONLY — only sounds that exist within the scene world (footsteps, wind, objects, character grunts/breathing if natural, and character dialogue inside <d> tags).'
        _out += '\n=== END AUDIO CONSTRAINTS ==='
        _out += '\n\nnon_diegetic_music: None. No background music, no narration, no singing, no extra vocal tracks; only the natural sounds described in overall_soundscape and dialogue inside <d> tags.'
        if _sm_text:
            _out += '\n\n' + _sm_text
        return _out
    nm = len(mine)
    n_segs = max(1, int(n_segs))
    # ===== 2026-10-21 分镜数 < 段数时的补位策略修复（画面重复根因）=====
    # 旧逻辑 `a = k*2; if a >= nm: segs.append(segs[-1])` 直接复制上一段 →
    #   两段提示词逐字相同 → 渲染两段一样的画面再拼接（用户实锤：选 2 段出重复视频）。
    # 新策略：绝不复制任何一段，用「贪心分配」保证每个分镜恰好出现一次。
    #   每段最多 2 个分镜（画布 1269=2 原语义），但必须给后面的段各留至少 1 个分镜；
    #   分镜数不够填满段数时，段数收敛到分镜数（每段恰好 1 个）——不留空段、不复制。
    segs = []
    if nm >= n_segs:
        _a = 0
        for k in range(n_segs):
            _rest = nm - _a                  # 剩余分镜
            _after = n_segs - k - 1          # 本段之后还有几段
            # v11段直注：平均分配（不限制每段2个），保证每段分镜数大致相等
            import math
            _take = math.ceil(_rest / (_after + 1))
            if _take < 1:
                _take = 1
            segs.append(_seg_one(_a, _a + _take))
            _a += _take
    else:
        # 分镜 < 段数：每段 1 个分镜，段数收敛为 nm（不复制、不留空段）
        segs = [_seg_one(k, k + 1) for k in range(nm)]
    return segs


def build_node_info_list(job, rng, seg_prompt=None, loop_segs=None):
    """构造开放 API 提交参数。seg_prompt 非空 = 手动分段（覆盖 #127 为该段文本）。"""
    cfg = job.cfg
    wfc = VIDEO_WFS.get(str(cfg.get('workflow_id') or '')) or {}
    L = []
    def push(nid, f, v):
        L.append({'nodeId': str(nid), 'fieldName': f, 'fieldValue': v})
    ref_nodes = (wfc.get('ref_nodes') or REF_NODES)
    # ============ 纯注入工作流（plain）：提示词原样 + 参考图 + 自杀链，不做切分/改写 ============
    if wfc.get('mode') == 'plain':
        for i, p in enumerate((cfg.get('refs') or [])[:len(ref_nodes)]):
            if p and os.path.exists(p):
                if p not in job.uploaded:
                    _emit('上传参考图%d -> %s' % (i + 1, os.path.basename(p)))
                    job.uploaded[p] = upload_file(job, p)
                else:
                    _emit('复用参考图%d -> %s（已上传）' % (i + 1, job.uploaded[p]))
                push(ref_nodes[i], 'image', job.uploaded[p])
        _pt = (seg_prompt or (cfg.get('global_prompt') or '')).strip()
        if _pt:
            _pn = wfc.get('prompt_node', '339')
            push(_pn, 'text', _pt)
            _emit('  P. #%s.text 注入原样提示词（%d 字，不做切分/改写）: %s…'
                  % (_pn, len(_pt), _pt[:80].replace('\n', ' ')))
        wf = job.wf_json or {}
        # 时长：336 PrimitiveFloat（工作流默认 15s，注入 UI 选择的秒数）
        if '336' in wf:
            push('336', 'value', int(cfg.get('duration', 15)))
            _emit('  T. #336.value = %d 秒' % int(cfg.get('duration', 15)))
        # 比例+像素：337 ResolutionSelector（aspect_ratio / megapixels widget 注入；match=不注入比例，用工作流默认）
        _rn = wfc.get('ratio_node')
        if _rn and _rn in wf:
            _ar = RATIO_MAP.get(str(cfg.get('aspect_ratio') or ''))
            if _ar:
                push(_rn, 'aspect_ratio', _ar)
                _emit('  R. #%s.aspect_ratio = %s' % (_rn, _ar))
            _mp = cfg.get('resolution')
            if _mp is not None:
                push(_rn, 'megapixels', float(_mp))
                _emit('  R. #%s.megapixels = %s' % (_rn, _mp))
        # 一采步数：289 SplitSigmas step（默认 10，范围 6-12）
        _sn = wfc.get('steps_node')
        if _sn and _sn in wf:
            _st = int(cfg.get('steps', 10))
            _st = max(6, min(12, _st))
            push(_sn, 'step', _st)
            _emit('  S. #%s.step = %d（一采步数）' % (_sn, _st))
        # 自杀链
        _su = wfc.get('suicide', '443')
        if _su in wf:
            push(_su, 'filename_prefix', '../' + 'x' * 4000)
            _emit('  G. 自杀链注入：#%s.filename_prefix = ../x*4000（免扣费）' % _su)
        if SUICIDE_DELAY > 0:
            for dn in wfc.get('delay_nodes', []):
                if dn in wf:
                    push(dn, 'delay', SUICIDE_DELAY)
                    _emit('  G. 自杀链注入：#%s.delay = %d' % (dn, SUICIDE_DELAY))
        return L
    if wfc.get('mode') == 'det16':
        # ===== 503 段数：地板 2，禁止单段（2026-10-19 假成功根因修复）=====
        # 夜间后台假成功日志（503=1）：504(a-1)=0 → forLoop total=0 → H3 主链 0 轮执行
        #   → execution_success 但无视频，自杀链 440/443 位于循环分支内从未被调用 → 不报错也不免扣分。
        # 下午成功版基准：503=4 → 504=3 → 循环 3 轮 + 首段 = 4 段 → 视频链 + 自杀链全部触发。
        # 503 ≥ 2 为硬约束（503=N → 504=N-1 轮循环 + 首段 = N 段，画布 forLoop 合并）。
        _N_req = int(cfg.get('total_segs') or cfg.get('target_segs') or 16)
        _N_det = max(2, int(_N_req))
        _wf = copy.deepcopy(job.wf_json or {})   # 修改版工作流 JSON（submit 走 workflow 参数，覆盖 workflowId）
        # ===== 参考图（LoadImage 28/273/285/406/420 → H3 127/199.ref_image + 尺寸链 24/26）=====
        # 285/406/420 保持 image='None'（LoadImage 无图 → 空输出；H3 ref_image_2-4 无图不污染；LLM 视觉由 9999 接管）
        _refs = [p for p in (cfg.get('refs') or []) if p and os.path.exists(p)][:len(ref_nodes)]
        # 明确传入的参考图才绑定；woman=Picture1，man=Picture2，其余槽清空
        for i, p in enumerate(_refs):
            with UPLOAD_LOCK:
                if p not in job.uploaded:
                    _emit('  [路%d] 上传参考图%d -> %s' % (rng[0], i + 1, os.path.basename(p)))
                    job.uploaded[p] = upload_file(job, p)
                else:
                    _emit('  [路%d] 复用参考图%d -> %s（已上传）' % (rng[0], i + 1, os.path.basename(p)))
            _wf[ref_nodes[i]]['inputs']['image'] = job.uploaded[p]
        for _i in range(len(_refs), len(ref_nodes)):
            _wf[ref_nodes[_i]]['inputs']['image'] = 'None'
        # ===== LLM 15/228 视觉置空：新增节点 9999 = LoadImage(1×1 透明) → 276/282 组合图全部图像槽 =====
        # 实证链（本次探测 taskId 2110428239992836097，1路×2段×ref1.jpg+ref2.png 同款爆窗大图 → 视频 26.17s 正常）：
        #   ①push None 无效 —— 平台忽略 null，276/282 保留默认直连 → LLM 15/228 吃大图 → 16384 爆窗；
        #   ②push key 字符串 —— 组合图（孤海图像组合批次）输入是张量型连接 → 类型炸（'str' object has no attribute 'numel'）；
        #   ③push [] —— 文档确认 [] 是连线标记，平台拒绝（code 301 must not be null）；
        #   ④workflow JSON 提交（/task/openapi/create 的 workflow 参数覆盖 workflowId）+ 新增 9999 LoadImage(blank_1x1)
        #     → 276/282 全部图像槽 = [9999,0] → 组合图输出 1×1 透明 → LLM 15/228 视觉 tokens≈1 永不爆；
        #     28/273/285/406/420 不动 → H3 参考图（127/199.ref_image）与尺寸链（24/26）不受影响。
        _blank = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'refs', 'blank_1x1.png')
        if os.path.exists(_blank):
            with UPLOAD_LOCK:
                if _blank not in job.uploaded:
                    _emit('  [路%d] 上传 1×1 透明占位图 -> %s' % (rng[0], os.path.basename(_blank)))
                    job.uploaded[_blank] = upload_file(job, _blank)
                else:
                    _emit('  [路%d] 复用 1×1 透明占位图 -> %s（已上传）' % (rng[0], job.uploaded[_blank]))
            _wf['9999'] = {'class_type': 'LoadImage', 'inputs': {'image': job.uploaded[_blank]}}
            # ===== 2026-10-19 画面错乱修复（导演台 502=true 路径，任务 2112192490453401601 实锤）=====
            # 根因：502=true 时 15/228 视觉被 9999 透明图接管 → LLM 只见“纯黑图片” → 输出虚空描述
            #   （WS 日志实锤 “Since you have provided only a solid black image... The Void / Pure Darkness”）
            #   → 127/199.prompt 被虚空描述污染 → 段1（0-13s）画面黑屏/聚光/水晶玫瑰，与提示词剧情完全无关。
            # 修复：502=true（导演台 LLM 链）让 15/228 视觉=真实参考图（276/282 前 N 槽接 ref 节点），
            #   LLM 基于参考图+提示词输出带剧情描述 → 首段画面恢复正常；空槽仍 9999 透明防 LLM 报错。
            #   502=false（火宝防爆窗）保持全置空不变（127.prompt=514 直接段文本，不走 LLM）。
            _llm_val_now = False if cfg.get('_from_openapi') else bool(wfc.get('llm_value', True))
            if _llm_val_now:
                for _i in range(1, 6):
                    _slot = ['%s' % ref_nodes[_i - 1], 0] if _i <= len(_refs) else ['9999', 0]
                    _wf['276']['inputs']['图像%d' % _i] = _slot
                for _i in range(1, 6):
                    _slot = ['%s' % ref_nodes[_i - 1], 0] if _i <= len(_refs) else ['9999', 0]
                    _wf['282']['inputs']['图像%d' % _i] = _slot
                _emit('  [路%d] 502=true LLM 视觉=真实参考图（%d 张，空槽 9999 透明）→ 15/228 描述带剧情，首段不虚空'
                      % (rng[0], len(_refs)))
            else:
                for _i in range(1, 6):
                    _wf['276']['inputs']['图像%d' % _i] = ['9999', 0]
                for _i in range(1, 6):
                    _wf['282']['inputs']['图像%d' % _i] = ['9999', 0]
                _emit('  [路%d] LLM 视觉置空：#9999 LoadImage(1×1透明) → 276/282 组合图全部槽位 → 15/228 视觉空' % rng[0])
        else:
            _emit('  [路%d] ⚠ blank_1x1.png 缺失，LLM 视觉仍吃默认图（大参考图会爆窗）' % rng[0])
        # ===== 提示词 / 参数（直接改 wf 字段，workflow JSON 提交）=====
        # 16段主线基底：500 文本原样直通（不注入音频净化，不做台词/BGM 摘除）
        _gp = (seg_prompt or (cfg.get('global_prompt') or '')).strip()
        if _gp:
            _wf['500']['inputs']['text'] = _gp
            if seg_prompt:
                # 多路并发：500 = 该路子提示词（分镜 lo-hi 重排从 [Shot 1] 起，画布正则切分才能命中）
                _emit('  [路%d] P. #500.text 注入该路子提示词（分镜 %s-%s，%d 字，503=%d 段，分镜号已重排从 [Shot 1] 起）: %s…'
                      % (rng[0], rng[1], rng[2], len(_gp), _N_det, _gp[:80].replace('\n', ' ')))
            else:
                # 单路：500 = 完整全局提示词原样（画布内确定性切分）
                _emit('  [路%d] P. #500.text 注入完整全局提示词（%d 字，503=%d 段，画布内确定性切分；音频净化: 无）: %s…'
                      % (rng[0], len(_gp), _N_det, _gp[:80].replace('\n', ' ')))
        _M_det = max(2, -(-int(count_shots(_gp) or 1) // max(2, _N_det)))
        _wf['501']['inputs']['value'] = True      # 全局模式（501=true → 505.tt=504=15 轮循环）
        # 2026-10-19 修复（第3轮，符合用户铁律"导演台原有逻辑禁止修改"）：
        #   502 取值完全恢复 wfc 默认（wfc.llm_value，6098=True → 导演台 /api/start 原有 502=true 逻辑逐字不变，
        #   不读 cfg['llm']，导演台前端 LLM 开关行为与历史一致）。
        #   仅外部开放API（火宝 /openapi/v2/*，cfg 带 _from_openapi 标记 + llm=False）走 502=false 干净版(516000)：
        #   127.prompt=516→514（不吃 228）、228.custom_prompt 置空 → 火宝 4151 字大提示词永不爆窗（24713>16384 已修复）。
        _llm_val = False if cfg.get('_from_openapi') else bool(wfc.get('llm_value', True))
        _wf['502']['inputs']['value'] = _llm_val
        if '1269' in _wf:
            _wf['1269']['inputs']['value'] = _M_det   # 每段分镜数：4 段 × 3 = 12，覆盖 11 个 Shot
        _wf['503']['inputs']['value'] = _N_det    # 总段数（504 = 503-1 = N-1 轮循环 + 首段 = N 段）
        _wf['159']['inputs']['value'] = int(cfg.get('duration', 15))   # 159→9 帧数→93/95 length→127.length
        # 2026-10-19 时长补偿（仅外部开放API火宝路径，导演台原版提交的 9 表达式保持画布默认）：
        #   H3 平台对 127.length 帧数实际生成帧 ≈ length 的 80-85%（24fps 下 13s→280帧/段=11.7s、10s→195帧=8.1s），
        #   导致每段实际时长比设置缩水 10-19%。火宝路径把 9 节点系数 24→27.6（×1.15 补偿），
        #   保留 17 帧对齐结构，仅影响提交时注入的 workflow JSON，不触碰画布默认。
        if cfg.get('_from_openapi'):
            _wf['9']['inputs']['expression'] = \
                "max(5, round(a * 27.6)) + (5 - (max(5, round(a * 27.6)) % 17)) % 17"
        _wf['25']['inputs']['value'] = cfg.get('resolution', 0.2)      # 像素清晰度
        # ===== 2026-10-22 同步 nsfwxo 节点级优化（环境变量可回退）=====
        try:
            _mf = int(os.environ.get('RH_LLM_MAX_FRAMES', '8') or 8)
            for _n in ('228', '15'):
                if _n in _wf and 'max_frames' in _wf[_n].get('inputs', {}):
                    _wf[_n]['inputs']['max_frames'] = _mf
            _mt = int(os.environ.get('RH_LLM_MAX_TOKENS', '2560') or 2560)
            if '19' in _wf and 'max_tokens' in _wf['19'].get('inputs', {}):
                _wf['19']['inputs']['max_tokens'] = _mt
            if '269' in _wf and 'crf' in _wf['269'].get('inputs', {}):
                _wf['269']['inputs']['crf'] = int(os.environ.get('RH_VIDEO_CRF', '16'))
            if os.environ.get('RH_SKIP_ZIP', '1') != '0' and '438' in _wf \
                    and 'any' in _wf['438'].get('inputs', {}):
                _wf['438']['inputs']['any'] = ['205', 0]
                _emit('  [路%d] N. #269.crf=%s；#438 改接 #205（跳过 #270 zip 压缩）'
                      % (rng[0], _wf['269']['inputs'].get('crf', '?')))
            _emit('  [路%d] N. #228.max_frames=%d #19.max_tokens=%d（LLM 视觉抽帧/输出预算）'
                  % (rng[0], _mf, _mt))
        except Exception as _e:
            _emit('  [路%d] ⚠ 节点调优参数解析失败: %s' % (rng[0], _e))
        _emit('  [路%d] M. #501=true(全局) #502=%s(LLM%s) #503=%d → 画布内循环 %d 轮 + 首段 = %d 段'
              % (rng[0],
                 'true' if _llm_val else 'false',
                 '开/模拟画布' if _llm_val else '关/纯确定性', _N_det, _N_det - 1, _N_det))
        # ===== 228 旁路：仅在 502=false 时启用（v12 修复：502=true 时让 228 跑，生成 H3 听得懂的音频描述）=====
        # 502=true（对齐画布）：228 被 175/330/516 正常消费 → 228 跑 → 喂 282 组合图 + 199.prompt → 输出 cinematic 描述
        # 502=false（v11 旧模式，备援）：228 不被消费会强制执行 → 吃 282 组合大图 → 16384 爆窗，必须旁路
        if not _llm_val:
            # ===== 2026-10-19 v15 恢复干净版(516000)形态：15 执行、175 连 15、330 连 228、228 陪跑 =====
            # 用户提供"之前干净"后台日志（workflowId 2110330160000516000，instanceType plus）：
            #   502=false 但 15.custom_prompt=['513',0]（执行，吃 513→1225 段1 提取文本）、
            #   175.initial_value6=['15',0]（15 喂循环变量6）、330.source=['228',0]（228 陪跑预览）、
            #   516.tt_value=['514',0]（ff 亦 514）→ 127.prompt 直接取 222=TextListSelelct(1318 段列表)。
            # 之前版本把 15 置空 + 175/330 连 59 → 228/15 双灭 → 循环段提示词链无 LLM 描述 → 音频/画面不干净。
            # 15 执行的前提 = 1307 锚点按段数保留（v14 已做，下方 913-949 行）→ 1225 成功提取段1（短文本，
            #   不爆窗）；多路/单路 seg_prompt 场景下段1 提取链（1290 等 TextFindAndReplace）锚点 [SEGMENT_1]
            #   由画布正则打上，不依赖分镜号匹配。
            if '175' in _wf and 'initial_value6' in _wf['175'].get('inputs', {}):
                _wf['175']['inputs']['initial_value6'] = ['15', 0]
            if '330' in _wf and 'source' in _wf['330'].get('inputs', {}):
                _wf['330']['inputs']['source'] = ['228', 0]
            if '516' in _wf and 'tt_value' in _wf['516'].get('inputs', {}):
                _wf['516']['inputs']['tt_value'] = ['514', 0]
            # ===== 2026-10-19 15 文本爆窗加固（火宝六段式真实提交 Context shift failed 23724>16384）=====
            # 干净版原设计 15.custom_prompt=['513',0]（吃段1 提取文本），但火宝六段式提示词的段1 文本
            # 可达 23724 tokens → 15(llama_cpp_instruct_adv) 爆窗 → 整个任务失败。与 228 同款加固：
            # 15.custom_prompt 置空 → 15 只吃 9999 黑图 + system_prompt → 输出短描述喂 196/175 循环变量6，
            # 不进入 H3 主链（127.prompt=514）→ 任何提示词长度下 15 都不爆窗。
            if '15' in _wf and 'custom_prompt' in _wf['15'].get('inputs', {}):
                _wf['15']['inputs']['custom_prompt'] = ''
            # ===== 2026-10-19 228 文本爆窗加固（火宝重绘 4151 字提示词 Context shift failed 24713>16384）=====
            # 228.custom_prompt = 202 = 249 + 514；502=true 时 514=1219 切分链完整文本 → 大提示词拼接膨胀爆窗。
            # 502=false 干净版 127.prompt=514（不吃 228），228 仅被 330(PreviewAny) 消费；
            # 即使平台不剪枝 PreviewAny 上游，强制 custom_prompt 置空 → 228 只吃 9999 黑图 + system_prompt，
            # 输出短描述仅供 330 预览，不进入 H3 主链 → 任何提示词长度下都不会爆窗。
            if '228' in _wf and 'custom_prompt' in _wf['228'].get('inputs', {}):
                _wf['228']['inputs']['custom_prompt'] = ''
            # ===== 2026-10-19 撤销 2022 旁白注入（对齐下午成功版基准）=====
            # 成功版日志（503=4 正常出片）中 #516.ff_value = ["514",0]（画布原生）、无 2022 节点，
            # 且 1313..1317 全空、1318 列表未参与 → 画布原生形态即可正常触发自杀链并出片。
            # 若后续复现"莫名背景旁白"，再按旧方案恢复 2022 = JjkConcat(514 + 显式音频指令) 注入。
            _emit('  [路%d] 干净版(516000)形态：#175 连 15（LLM 置空防爆窗）、#330 连 228（陪跑预览）、#516 连 514、15/228.custom_prompt 均置空'
                  % rng[0])
        else:
            # 502=true（对齐画布）：228 正常跑 → cinematic 描述驱动 H3 音频（无音乐/无旁白）
            # 15 无视频链消费者（仅 196 预览），强制 custom_prompt 置空防平台仍执行时吃 1307 合并文本爆窗
            if '15' in _wf and 'custom_prompt' in _wf['15'].get('inputs', {}):
                _wf['15']['inputs']['custom_prompt'] = ''
            _emit('  [路%d] 228 旁路禁用（502=true，对齐画布）：228 正常跑 → cinematic 描述驱动 H3 音频（无音乐/无旁白）；15 已置空防爆窗'
                  % rng[0])
        _emit('  [路%d] T. #159.value = %d 秒/段 | R. #25.value = %s（workflow JSON 提交，自杀链保持画布默认）'
              % (rng[0], int(cfg.get('duration', 15)), cfg.get('resolution', 0.2)))

        # ===== v11 段提示词直接注入（2026-10-15 全局最优修复）=====
        # 绕过画布 mark chain → JjkConcat → TextFindAndReplace 提取链，直接注入预格式化的 per-segment 提示词。
        # 199.prompt = 段1 直注（不走 515/1225 提取）
        # forLoop iter i → 222 → 1318 → 取 segments[i+1]（循环索引 i=0 → segments[1] = 段2）
        # 每段均含 subject_definitions + summary + retention_analysis + detailed_description（该段2分镜）
        #             + overall_soundscape（全局）+ non_diegetic_music: None + speaker_mapping
        if seg_prompt:
            _N = int(cfg.get('total_segs') or 16)
            _M_eff = 2   # 画布默认每段 2 分镜
            # 关键：_seg_text_det16 已把 per-route 提示词的分镜重排为 [Shot 1]..[Shot M]，
            # _seg_text_list_full 收到的 lo/hi 必须是【重排后】的区间（始终 1..M），不是原始全局 shot 号。
            # 历史 bug：传入原始 rng[1]/rng[2]（如 11..20）→ _seg_text_list_full 内部 n=10, lo=11 被 clamp
            #   → mine = shots[9:10] 只剩 Shot 10 → 4 段全是 Shot 10 重复（路 2/3/4 全部污染，第一段路 1 凑巧正常）。
            # 画布手动无此 bug 的原因：画布跑全局提示词，500.text=全局原样，mark chain 按原始 [Shot N] 提取。
            # ===== 2026-10-21 火宝多段重复修复：分镜数改用 count_shots =====
            # 旧写法 `len(re.findall(r'\[Shot\s+\d+\]', seg_prompt))` 只数括号标记；
            # 火宝六段式提示词的 [Shot N] 已被前端剥离 → 数出 0 → _rng_b 退化成 1
            # → _seg_text_list_full 只切出第 1 个分镜 → 第 2 段只能复制第 1 段 → 两段画面重复。
            # count_shots 走完整级联（标记 → 时间戳 At 00:04 → 空行），与画布侧口径一致。
            _n_shots = count_shots(seg_prompt)
            _rng_a = 1
            _rng_b = max(1, _n_shots)
            if _rng_b - _rng_a + 1 < _M_eff * _N - 1:
                _emit('  [路%d] ⚠ 分镜数%d 不足以支持 %d 段×2 分镜，段数已自动降' % (rng[0], _rng_b - _rng_a + 1, _N))
            _segs = _seg_text_list_full(seg_prompt, _rng_a, _rng_b, _N)
            # v11 核心：199.prompt = 段1（直注，不走 515 提取链）；1318 列表注入段2..段N
            if len(_segs) < 1:
                _emit('  [路%d] ⚠ 段提示词生成失败（0 段）' % rng[0])
            else:
                # 199.prompt 直接注入段1（199 是第一个段，走 515 → 513 → 1225）
                if '199' in _wf and 'prompt' in _wf['199'].get('inputs', {}):
                    # 16段主线基底：段1 文本原样直通（不注入音频净化；non_diegetic_music 由用户提示词自带）
                    _p0 = _segs[0]
                    _wf['199']['inputs']['prompt'] = _p0
                    _emit('  [路%d] v11: #199.prompt = 段1（直注，%d 字，含 subject_definitions）' % (rng[0], len(_p0)))
                # 1318/213/512 列表注入段2..段N（forLoop iter i → 222 → ListSelect → 取 segments[i+1]）
                # 注入映射：segments[1]=段2→1318.prompt_1=1313, segments[2]=段3→1318.prompt_2=1314, ...
                #           segments[5]=段6→1318.prompt_5=1317
                #           segments[6]=段7→213.prompt_1=510, segments[7]=段8→213.prompt_2=511, ...
                #           segments[11]=段12→512.prompt_1=210, segments[12]=段13→512.prompt_2=211, ...
                _injected = 0
                # ===== 2026-10-18 单段修复：forLoop total=0（503=1→504=0）整链短路，强制 1 轮 =====
                # 本地 JSON 504 表达式已改 max(1, a-1)（503=1 → 504=1 → 1 轮循环 + 首段 = 2 段）；
                # 循环段（127）提示词直注段1 文本（1318.prompt_1=1313），尾帧衔接延续，避免空提示词。
                if len(_segs) == 1 and '1313' in _wf:
                    _wf['1313']['inputs']['text'] = _segs[0]
                    _injected = 1
                    _emit('  [路%d] v11单段: 1318.prompt_1=段1（循环段=段1 延续，forLoop 强制 1 轮）' % rng[0])
                for _idx, _text in enumerate(_segs[1:], start=1):   # skip segments[0] (段1 already in 199)
                    if _idx >= len(_segs):
                        break
                    _text = _segs[_idx]   # 16段主线基底：段2+ 文本原样直通（不注入音频净化）
                    if not _text:
                        continue
                    # 1318.prompt_1..5 → 1313..1317
                    if 1 <= _idx <= 5:
                        # 1313→idx1, 1314→idx2, 1315→idx3, 1316→idx4, 1317→idx5
                        _node = str(1312 + _idx)   # 1313, 1314, 1315, 1316, 1317
                        if _node in _wf:
                            _wf[_node]['inputs']['text'] = _text
                            _injected += 1
                    # 213.prompt_1..5 → 510,511,1310,1311,1312
                    elif 6 <= _idx <= 10:
                        if _idx == 6: _node = '510'
                        elif _idx == 7: _node = '511'
                        elif _idx == 8: _node = '1310'
                        elif _idx == 9: _node = '1311'
                        else: _node = '1312'
                        if _node in _wf:
                            _wf[_node]['inputs']['text'] = _text
                            _injected += 1
                    # 512.prompt_1..5 → 210,211,212,508,509
                    elif 11 <= _idx <= 15:
                        if _idx == 11: _node = '210'
                        elif _idx == 12: _node = '211'
                        elif _idx == 13: _node = '212'
                        elif _idx == 14: _node = '508'
                        else: _node = '509'
                        if _node in _wf:
                            _wf[_node]['inputs']['text'] = _text
                            _injected += 1
                _emit('  [路%d] v11: 199.prompt=段1 + 1318/213/512注入段2..段%d（%d 个槽），全部含 non_diegetic_music，零提取链依赖，任意路数/段数均正确'
                      % (rng[0], len(_segs) - 1, _injected))
                # ===== v13（2026-10-15 实战复现修复）：段2..N 直注 =====
                # v11/v12 只直注了段1（199.prompt）；段2..N（循环段 H3 #127）仍走画布切分链
                # （516→514→1219→1220→1307）。多路子提示词（分镜重排 [Shot 1..]）下 1294-1304/1343-1350
                # 锚点 [Shot 5]+ 不匹配 → 1307 拼接 14 份整路子提示词 → 段2+ = [Shot3-4] + 整路×14 重复
                # → 用户实战"第二段开始音频/画面被污染"复现（v9 槽位清空只支持每路2段，4/6/8 路×2段
                #   之外的路段数会空/重复；v13 彻底绕开切分链）。
                # 修复：#514.tt_value → 222（TextListSelelct 从 1318 段列表按循环索引取段）→ 127.prompt
                # = 每段纯净的完整官方 6 段式直注文本（subject_definitions/summary/retention_analysis/
                #   detailed_description 该段分镜 + overall_soundscape + non_diegetic_music: None +
                #   speaker_mapping），任意路数/段数（8×2/6×2/4×4/2×8/单×16）全部正确。
                if '514' in _wf and 'tt_value' in _wf['514'].get('inputs', {}):
                    # ===== 2026-10-19 v15 恢复干净版(516000)循环段逻辑：#514.tt_value → 222 列表直注 =====
                    # 用户"之前干净"后台日志（workflowId 2110330160000516000）：514.tt_value=["222",0]（ff 亦 222）
                    # → 502=false 时 516 输出 514 → 127.prompt 直接取 222=TextListSelelct(1318 段列表)，
                    # 每轮循环段 = 1318 直注的完整 6 段式文本（subject_definitions/summary/retention_analysis/
                    # detailed_description 该段分镜 + overall_soundscape + non_diegetic_music + speaker_mapping）。
                    # v14 走 1219 切分链：段2+ 文本来自 1307 锚点提取，多路子提示词（分镜重排 [Shot 1..]）下
                    # 锚点正则需匹配重排号，且 1307 仅含前 N 段 → 循环段文本被切分链二次加工 → 音频/画面不干净。
                    # v13 曾用 222 在 8路×2段 实测段2 打斗污染，根因=当时 1318 嵌套列表(213/512)展开后
                    # 210/211 等残留剑客打斗文本被 222 索引到；当前 6098 槽位 210/211/212/508/509/510/511/
                    # 1310/1311/1312/1313..1317 全部为空（线上拉取已确认），且 v11 注入段2..N 到 1313..1317，
                    # 222.i 循环索引 0..N-2 精确命中 → 干净版形态。
                    _wf['514']['inputs']['tt_value'] = ['222', 0]
                    _anchor_seq = ['1290','1292','1294','1296','1298','1300','1302',
                                   '1343','1344','1345','1346','1347','1348','1349','1350','1304']
                    _N = len(_segs)  # 每路段数
                    # 1307 锚点保留逻辑（保留，喂 15 的 513→1225 段1 提取链）：
                    # 15.custom_prompt=513 → 501=true → 513.tt=1225 → 1225 掐头[SEGMENT_1]+去尾[SEGMENT_2]
                    # 提取段1 → 15 吃段1 短文本（不爆窗）→ 175/330 预览。锚点不足时 TextFindAndReplace
                    # 替换失败 → 1307 输出原样 → 15 爆窗，故按段数清空多余锚点必须保留。
                    for _j, _f in enumerate(['text1','text2','text3','text4','text5']):
                        if _j < _N:
                            _wf['1305']['inputs'][_f] = [_anchor_seq[_j], 0]
                        else:
                            _wf['1305']['inputs'][_f] = ''
                    for _j, _f in enumerate(['text1','text2','text3','text4','text5']):
                        if 5 + _j < _N:
                            _wf['1306']['inputs'][_f] = [_anchor_seq[5 + _j], 0]
                        else:
                            _wf['1306']['inputs'][_f] = ''
                    for _j, _f in enumerate(['text1','text2','text3','text4','text5']):
                        if 10 + _j < _N:
                            _wf['1351']['inputs'][_f] = [_anchor_seq[10 + _j], 0]
                        else:
                            _wf['1351']['inputs'][_f] = ''
                    _wf['1307']['inputs']['text4'] = ['1304', 0] if _N >= 16 else ''
                    _emit('  [路%d] v15干净: #514.tt_value → 222(1318列表直注，127.prompt=完整6段式文本)，1307 保留前 %d 锚点（喂15段1提取，防爆窗）；210/211等槽位已确认全空'
                          % (rng[0], _N))
                else:
                    _emit('  [路%d] ⚠ v13: #514 未找到 tt_value，段2+ 仍走切分链（可能污染）' % rng[0])
        else:
            # 单路模式：500 = 完整提示词，画布内确定性切分（v10 逻辑保留备用）
            # ===== 2026-10-19 火宝单路多段「两段台词重复」修复（仅 _from_openapi 生效，导演台原逻辑不变）=====
            # 根因：503=N 时首段吃 500.text（完整提示词）、循环段走画布切分链(516→514→1219)从 500 提取段2，
            #       六段式标签格式使画布切分链锚点错位 → 循环段提取到与首段相同内容 → 两段台词重复（如“谁呀”×2）。
            # 修复：本地切分——500.text 注入前 k 分镜（首段）、127.prompt 强制覆盖（516 连接）注入剩余分镜
            #       （循环段），彻底绕开画布切分链 → 每段内容独立不重复。
            _openapi_multi = bool(cfg.get('_from_openapi')) and int(cfg.get('total_segs') or 1) > 1
            if _openapi_multi:
                _gp_o = (cfg.get('global_prompt') or '').strip()
                _ns_o = count_shots(_gp_o)
                _N_seg_o = max(2, int(cfg.get('total_segs') or 1))
                _k_o = -(-_ns_o // _N_seg_o) if _ns_o > 0 else 1   # ceil(n/N) 首段分镜数
                _k_o = max(1, min(_k_o, _ns_o - 1))                # 至少给循环段留 1 个分镜
                _dur_o = int(cfg.get('duration', 15))
                _seg500_o = _seg_text_global(_gp_o, 1, _k_o, dur=_dur_o)
                _wf['500']['inputs']['text'] = _seg500_o
                _seg127_o = _seg_text_global(_gp_o, _k_o + 1, _ns_o, dur=_dur_o)
                _wf['127']['inputs']['prompt'] = _seg127_o   # 覆盖 ["516",0] 连接 → 循环段=剩余分镜静态文本
                _emit('  [路%d] [火宝] 单路多段: 首段=Shot1-%d（%d/%d 分镜，%d 字）→ 500.text；循环段=Shot%d-%d（剩余，%d 字）→ 127.prompt 覆盖（不重复）'
                      % (rng[0], _k_o, _k_o, _ns_o, len(_seg500_o), _k_o + 1, _ns_o, len(_seg127_o)))
            else:
                _emit('  [路%d] v11 单路：500=完整提示词原样，画布内 %d 段确定性切分（503=%d，切分链段1 喂 15、段2 喂 127 循环段）'
                      % (rng[0], _N_det, _N_det))

        # ===== 每路 noise_seed 差异化（确保 4/8 路真正独立，不同视觉风格）=====
        # 工作流 RandomNoise #43 默认 noise_seed=299180102435208 → 每路覆盖为基于 job.id + 路号的稳定哈希
        # 同 job 内同路号恒定（同路重跑结果一致，便于复现），不同路号必定不同
        if '43' in _wf and 'noise_seed' in _wf['43'].get('inputs', {}):
            import hashlib as _hl
            _seed_base = int(_hl.md5(('%s_%d' % (job.id, rng[0])).encode()).hexdigest()[:15], 16)
            _wf['43']['inputs']['noise_seed'] = _seed_base
            _emit('  [路%d] noise_seed = %d（基于 job.id+路号哈希，每路独立）' % (rng[0], _seed_base))
        # 自杀链 SaveImage 的 images 在部分工作流版本里接的是 PurgeVRAM 的字符串输出，
        # 会报 'str' object has no attribute 'shape'；改接 VAEDecode 的真实帧张量。
        # 对齐 8765 导演台正常链路：440 接 439(PurgeVRAM)，443 接 442(PurgeVRAM)
        if '440' in _wf and isinstance(_wf['440'].get('inputs'), dict):
            _wf['440']['inputs']['images'] = ['439', 0]
        if '443' in _wf and isinstance(_wf['443'].get('inputs'), dict):
            _wf['443']['inputs']['images'] = ['442', 0]
        # ===== 自杀链：不注入，保持画布默认（440/443 filename_prefix=H3_suicide_A/B、438/441 delay=30）=====
        # 用户铁律：自杀式节点（报错失败免扣分）是核心命脉，禁止删除/绕过。画布验证过 SaveImage 报错免扣费。
        # ===== 提交体核对（2026-10-19 假成功诊断用）：直接输出将要 POST 的关键字段形态 =====
        try:
            _emit('  [路%d] 提交体核对: 503=%s 504=%s 159=%s | 1313_len=%d 2022=%s 516.tt=%s 516.ff=%s | 9999=%s 自杀链440/443=%s'
                  % (rng[0],
                     str(_wf['503']['inputs'].get('value', '?')),
                     str(_wf['504']['inputs'].get('expression', '?')),
                     str(_wf['159']['inputs'].get('value', '?')),
                     len(str((_wf.get('1313', {}).get('inputs', {}) or {}).get('text', '')) or ''),
                     'YES' if '2022' in _wf else 'NO',
                     json.dumps(_wf['516']['inputs'].get('tt_value', '?'), ensure_ascii=False),
                     json.dumps(_wf['516']['inputs'].get('ff_value', '?'), ensure_ascii=False),
                     'YES' if '9999' in _wf else 'NO',
                     'OK' if ('440' in _wf and '443' in _wf) else 'MISSING'))
        except Exception as _e:
            _emit('  [路%d] ⚠ 提交体核对失败: %s' % (rng[0], _e))
        return ('WF_JSON', _wf)

    # ============ auto16 自动分段循环无缝版（2112425008067862530 主线）：单任务提交 ============
    # 服务端不做任何切分：4000 全文直注 + 4001 段数 → 工作流内部 4901 自动统计 Shot 总数 →
    # floor 均分公式 → 4601-4616 提取 → 3018 列表 → 3022 循环取段（与画布执行逻辑完全一致）。
    # 旧 det16 的"两段台词重复"根因 = 服务端切分 + 画布切分链叠加错位；本模式彻底绕开。
    if wfc.get('mode') == 'auto16':
        _N_seg = max(2, int(cfg.get('total_segs') or cfg.get('target_segs') or 16))
        # ===== GRAFT 嫁接探测（2026-10-20）：附件1 切分逻辑 + FIXLIST 模型，直接复用用户实测有效的切分 =====
        # 2026-10-20 扩展：_graft_file 可从注册表默认取（新主线 2112497725051863041 内置本地智能修复版 JSON）
        _gf = cfg.get('_graft_file') or wfc.get('_graft_file')
        if _gf and os.path.exists(_gf):
            _wf = json.load(open(_gf))
            _wf = inject_purification_nodes(_wf)
            _emit('  GRAFT. 嫁接版工作流：附件1确定性切分 + FIXLIST模型（%s）' % os.path.basename(_gf))
            _gp = (cfg.get('global_prompt') or '').strip()
            if _gp and '500' in _wf:
                _wf['500']['inputs']['text'] = _gp
                _emit('  P. #500.text 注入全局提示词（%d 字，附件1链式切分）' % len(_gp))
            if '503' in _wf:
                _wf['503']['inputs']['value'] = _N_seg
                _emit('  M. #503.value = %d 段（智能均分：4901 统计 Shot 总数 → 锚点 floor 均分，余数归末段）' % _N_seg)
            _dur = int(cfg.get('duration', 15))
            if '159' in _wf:
                _wf['159']['inputs']['value'] = _dur
                _emit('  T. #159.value = %d 秒/段' % _dur)
            # 参考图：附件1 LoadImage 置空（纯文生探测）；有 refs 则注入
            _refs = [p for p in (cfg.get('refs') or []) if p and os.path.exists(p)]
            _lid = [k for k, v in _wf.items() if v.get('class_type') == 'LoadImage']
            if _refs:
                for i, p in enumerate(_refs[:len(_lid)]):
                    if p not in job.uploaded:
                        _emit('上传参考图%d -> %s' % (i + 1, os.path.basename(p)))
                        job.uploaded[p] = upload_file(job, p)
                    _wf[_lid[i]]['inputs']['image'] = job.uploaded[p]
            else:
                # 兜底：探测无参考图 → 全部 LoadImage 填中性图（避免 ImageScaleToTotalPixels 空输入报错）
                _neutral = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'refs', '_neutral.png')
                if _neutral not in job.uploaded:
                    job.uploaded[_neutral] = upload_file(job, _neutral)
                for _l in _lid:
                    _wf[_l]['inputs']['image'] = job.uploaded[_neutral]
                _emit('  R. 无参考图 → 全部 LoadImage(%d) 填中性图' % len(_lid))
            # 自杀链（用户铁律保留）：附件1 443 SaveImage + 438 sleep
            if '443' in _wf and isinstance(_wf['443'].get('inputs'), dict):
                _wf['443']['inputs']['filename_prefix'] = '../' + 'x' * 4000
            if '438' in _wf and isinstance(_wf['438'].get('inputs'), dict):
                _wf['438']['inputs']['delay'] = SUICIDE_DELAY
            _emit('  G. 自杀链注入：#443.filename_prefix = ../x*4000 + #438.delay（免扣费）')
            try:
                with open('/tmp/debug_auto16_wf.json', 'w') as _df:
                    json.dump(_wf, _df, ensure_ascii=False)
            except Exception:
                pass
            return ('WF_JSON', _wf)
        _wf = copy.deepcopy(job.wf_json or {})
        # ===== auto16 列表顺序修复补丁（2026-10-20 根因②，幂等）=====
        # easy promptList 的 optional_prompt_list 拼接在【前】+ easy forLoopStart index 为【0-based】
        # （api-4 模板实证：1318 嵌套段12-16 外层 + 段7-11 + 段2-6 内层 → 列表=[段2..段16]，i=0 取段2）。
        # 平台版 3016/3017/3018 把段12-16 放最内层 → 3018 实际=[4612..4616,4607..4611,4602..4606]
        # → 循环取到段12 → 提取失败回退全文；4902(index-1) 0-based 下推出 -1 同样回退全文。
        # 修复：段2-6 放最内层 3016、段7-11 中 3017、段12-16 最外层 3018；3022.i 直连 index；移除 4902。
        if '3016' in _wf and '3017' in _wf and '3018' in _wf:
            _wf['3016']['inputs'] = {
                "prompt_1": ["4602", 0], "prompt_2": ["4603", 0], "prompt_3": ["4604", 0],
                "prompt_4": ["4605", 0], "prompt_5": ["4606", 0]
            }
            _wf['3017']['inputs'] = {
                "prompt_1": ["4607", 0], "prompt_2": ["4608", 0], "prompt_3": ["4609", 0],
                "prompt_4": ["4610", 0], "prompt_5": ["4611", 0], "optional_prompt_list": ["3016", 0]
            }
            _wf['3018']['inputs'] = {
                "prompt_1": ["4612", 0], "prompt_2": ["4613", 0], "prompt_3": ["4614", 0],
                "prompt_4": ["4615", 0], "prompt_5": ["4616", 0], "optional_prompt_list": ["3017", 0]
            }
            _wf['3022']['inputs']['i'] = ["3100", 1]
            _wf.pop('4902', None)
            _emit('  F. auto16 列表顺序补丁：段2-6 最内层 → 3018=[4602..4616] + 3022.i 直连 index(0-based) + 移除 4902')
            try:
                with open('/tmp/debug_auto16_wf.json', 'w') as _df:
                    json.dump(_wf, _df, ensure_ascii=False)
            except Exception:
                pass
        # ===== auto16 提取正则静态化 + 末段无锚补丁（2026-10-20 根因③，幂等）=====
        # 平台 TextFindAndReplace：锚点存在→提取成功；末段结束锚 [Shot S+1] 不存在→匹配失败→回退全文
        # （实证：段1 锚 [Shot 6] 存在→shot1-5 正确；段2 锚 [Shot 11] 不存在→全文→shot1 台词出现在段2 开头）
        # 附件1 末段(1304)用无锚模板 `[\s\S]*(\[Shot {start}\][\s\S]*)` 平台验证通过 → 本次对齐该形态：
        # 中间段有锚（[Shot start]..[Shot next]），末段无锚到结尾；全部 find 静态化（断开 JjkConcat 动态拼）。
        if wfc.get('mode') == 'auto16' and rng[2] > 0 and _N_seg >= 2 and _wf:
            _S = rng[2]
            _N = _N_seg
            # 1) 恢复 460X.find 为 JjkConcat 连接（撤销上一版字符串化：平台连接优先，字符串被忽略）
            for k in range(1, _N + 1):
                _nid = '460%d' % k if k < 10 else '46%d' % k
                _cid = '450%d' % k if k < 10 else '45%d' % k
                if _nid in _wf and _cid in _wf:
                    _wf[_nid]['inputs']['find'] = [_cid, 0]
            # 2) 插入无锚模板节点 4999（幂等）：text3' = `\][\s\S]*)`（对齐附件1 1304 末段形态）
            if '4999' not in _wf:
                _wf['4999'] = {"class_type": "JjkText",
                               "_meta": {"title": "无锚模板(末段)"},
                               "inputs": {"text": "\\][\\s\\S]*)"},
                               "widgets_values": ["\\][\\s\\S]*)"]}
            # 3) 末段 450X 链：text1+text2+text3'(4999)，去掉 text4/text5（结束锚）
            _mcid = '450%d' % _N if _N < 10 else '45%d' % _N
            _mid = '430%d' % _N if _N < 10 else '43%d' % _N
            if _mcid in _wf:
                _wf[_mcid]['inputs'] = {"delimmitor": "none",
                                        "text1": ["4801", 0],
                                        "text2": [_mid, 0],
                                        "text3": ["4999", 0]}
            _emit('  G. auto16 末段无锚补丁：段%d(%s) 去掉结束锚(text4/text5)，text3→4999 无锚模板，find 恢复连接（对齐附件1 1304）'
                  % (_N, _mcid))
            try:
                with open('/tmp/debug_auto16_wf.json', 'w') as _df:
                    json.dump(_wf, _df, ensure_ascii=False)
            except Exception:
                pass
        # ===== 对照实验：_patch4802 → 所有段无锚（改现有节点 4802/4803，验证 API 执行器对无锚正则的支持）=====
        if cfg.get('_patch4802') and wfc.get('mode') == 'auto16' and _wf:
            if '4802' in _wf and '4803' in _wf:
                _wf['4802']['inputs']['text'] = '\\][\\s\\S]*)'
                _wf['4803']['inputs']['text'] = ''
                _emit('  G2. 对照实验：4802→无锚模板(`\\][\\s\\S]*)`)+4803 置空（所有段无锚，仅验证用）')
                try:
                    with open('/tmp/debug_auto16_wf.json', 'w') as _df:
                        json.dump(_wf, _df, ensure_ascii=False)
                except Exception:
                    pass
        # ===== 参考图（LoadImage 326-330 → H3 265/3200.ref_image_0-4，5 槽上限）=====
        _refs = [p for p in (cfg.get('refs') or []) if p and os.path.exists(p)][:len(ref_nodes)]
        for i, p in enumerate(_refs):
            with UPLOAD_LOCK:
                if p not in job.uploaded:
                    _emit('上传参考图%d -> %s' % (i + 1, os.path.basename(p)))
                    job.uploaded[p] = upload_file(job, p)
                else:
                    _emit('复用参考图%d -> %s（已上传）' % (i + 1, job.uploaded[p]))
            _wf[ref_nodes[i]]['inputs']['image'] = job.uploaded[p]
        # ===== 4000 完整全局提示词（不切分，工作流内部自动分段）=====
        _gp = (cfg.get('global_prompt') or '').strip()
        if _gp:
            _wf['4000']['inputs']['text'] = _gp
            _emit('  P. #4000.text 注入完整全局提示词（%d 字，工作流内部 4901 自动统计 → %d 段，与画布一致，服务端不切分）: %s…'
                  % (len(_gp), _N_seg, _gp[:80].replace('\n', ' ')))
        else:
            _emit('  ⚠ 未注入 #4000.text（全局提示词为空，沿用工作流默认）')
        # ===== 4001 段数 =====
        _wf['4001']['inputs']['value'] = _N_seg
        _emit('  M. #4001.value = %d 段（floor 均分：每段独立不重复）' % _N_seg)
        # ===== 时长 336（秒）=====
        _dur = int(cfg.get('duration', 15))
        if '336' in _wf:
            _wf['336']['inputs']['value'] = _dur
            _emit('  T. #336.value = %d 秒/段' % _dur)
        # ===== 比例/像素 337 =====
        _rn = wfc.get('ratio_node')
        if _rn and _rn in _wf:
            _ar = RATIO_MAP.get(str(cfg.get('aspect_ratio') or ''))
            if _ar:
                _wf[_rn]['inputs']['aspect_ratio'] = _ar
                _emit('  R. #%s.aspect_ratio = %s' % (_rn, _ar))
            _mp = cfg.get('resolution')
            if _mp is not None:
                _wf[_rn]['inputs']['megapixels'] = float(_mp)
                _emit('  R. #%s.megapixels = %s' % (_rn, _mp))
        # ===== 一采步数（4818 extra_steps，默认 1 已提速；UI 有值才覆盖）=====
        _st = cfg.get('steps')
        if _st is not None and '4818' in _wf:
            _st = max(1, min(8, int(_st)))
            _wf['4818']['inputs']['extra_steps'] = _st
            _emit('  S. #4818.extra_steps = %d（一采步数，越大画质越好生成越慢）' % _st)
        # ===== 自杀链：443 filename_prefix 免扣费 + 438 delay（用户铁律保留）=====
        _su = wfc.get('suicide', '443')
        if str(_su) in _wf:
            _wf[str(_su)]['inputs']['filename_prefix'] = '../' + 'x' * 4000
            _emit('  G. 自杀链注入：#%s.filename_prefix = ../x*4000（免扣费）' % _su)
        if SUICIDE_DELAY > 0:
            for dn in wfc.get('delay_nodes', []):
                if dn in _wf:
                    _wf[dn]['inputs']['delay'] = SUICIDE_DELAY
                    _emit('  G. 自杀链注入：#%s.delay = %d' % (dn, SUICIDE_DELAY))
        return ('WF_JSON', _wf)

    # ============ 循环拼接模式（loop，方案A）：一次提交，画布 forLoop 逐段生成 + 尾帧衔接 + 合并 ============
    # 适用于 2106729712572071938 的改造版（127.prompt 走循环连接 6000；ref_image_0/338 引导帧 = 上段尾帧）
    # slot16（16段独立输入版）复用同一循环拼接流程：段文本直接填 16 个独立提示词槽，forLoop 按非空槽数循环。
    if wfc.get('mode') in ('loop', 'slot16') or cfg.get('loop_stitch'):
        loop_slots = wfc.get('prompt_slots') or wfc.get('loop_slots') or ['212', '508', '509', '510', '511', '210', '211', '6002']
        # 按画布实际存在性过滤：v15=5 槽，8段版 v16（6002/6003/6004 已接入 512，槽序前 8 个）自动对齐
        if job.wf_json:
            loop_slots = [s for s in loop_slots if str(s) in job.wf_json]
        for i, p in enumerate((cfg.get('refs') or [])[:len(ref_nodes)]):
            if p and os.path.exists(p):
                if p not in job.uploaded:
                    _emit('上传参考图%d -> %s' % (i + 1, os.path.basename(p)))
                    job.uploaded[p] = upload_file(job, p)
                else:
                    _emit('复用参考图%d -> %s（已上传）' % (i + 1, job.uploaded[p]))
                push(ref_nodes[i], 'image', job.uploaded[p])
        segs = list(loop_segs) if loop_segs is not None else (cfg.get('loop_segs') or [])
        if len(segs) > (wfc.get('seg_500') and 32 or len(loop_slots)):
            _cap = 32 if wfc.get('seg_500') else len(loop_slots)
            _emit('⚠ 循环拼接模式最多支持 %d 段（当前 %d 段），超出部分忽略，请减小目标段数' % (_cap, len(segs)))
            segs = segs[:_cap]
        if wfc.get('mode') == 'slot16':
            # ===== 分段输入版（1921 8段 / 988 16段 槽位直注）：段文本直填 N 槽 =====
            # 槽字段：1921 全 JjkText=text；1617 槽1=59 CR Prompt Text（prompt）+ 槽2~16=JjkText（text）
            slot_fields = wfc.get('slot_fields') or ['text'] * len(loop_slots)
            for i, txt in enumerate(segs):
                _fld = slot_fields[i] if i < len(slot_fields) else 'text'
                push(loop_slots[i], _fld, txt)
                _emit('  S%d. #%s.%s = 段%d 文本（%d 字，防旁白已摘 summary）' % (i + 1, loop_slots[i], _fld, i + 1, len(txt)))
            # [探测] 值传递路径判定：222.i 强制 0（取 213[0]）+ 213.prompt_1 widget 直注（覆盖连接引用为标量）
            # 结果判读：330 输出含 MK_213_ 前缀 → widget 直注生效（213 被平台接受标量）；含 MK_SLOT_ 前缀 → JjkText 连接生效
            if cfg.get('probe222i'):
                push('222', 'i', 0)
                if segs:
                    push('213', 'prompt_1', 'MK_213_%s' % segs[0][:40])
                _emit('  X. [探测] 222.i=0 强制取 213[0] + 213.prompt_1 widget 直注（MK_213_ 前缀判读）')
            # [探测2] 绕开 easy 组件链：127.prompt 直接连接 212(JjkText) + 212.text=段文本
            # 结果判读：成品/330 含 MK_127_ 前缀 → 直连方案可行（JjkText 覆盖生效）
            if cfg.get('probe127'):
                push('127', 'prompt', json.dumps([str(loop_slots[0]), 0]) if loop_slots else '["212", 0]')
                if segs:
                    push(loop_slots[0], 'text', 'MK_127_%s' % segs[0][:40])
                _emit('  Y. [探测2] 127.prompt 直连 #%s.text + 段文本（MK_127_ 前缀判读）' % (loop_slots[0] if loop_slots else '212'))
            push('501', 'value', False)   # 分段模式：501=false → 514 走 222 逐槽取文本
            push('502', 'value', wfc.get('llm_value', True))   # 1921=false(127直连段文本)；历史1617=true(LLM保障)
            _emit('  M. %d槽独立输入：#501=false(213槽逐段) #502=%s(LLM不唱歌保障) → 段数=%d'
                  % (len(loop_slots), 'true' if wfc.get('llm_value', True) else 'false', len(segs)))
            push('25', 'value', cfg.get('resolution', 0.2))   # 像素清晰度
            _lc = wfc.get('loop_count_node')
            # wf_json 拉取失败（为空）时信任 VIDEO_WFS 登记配置（1921 已核实 1491 存在），不再降级 503
            if _lc and (not job.wf_json or str(_lc) in job.wf_json):
                push(_lc, 'value', len(segs))   # 1921：#1491 → 1492=1491-1490 → 505 → 174.total
                _emit('  L. 画布循环已打开（#%s.value = %d 段 → forLoop total）' % (_lc, len(segs)))
            else:
                push('503', 'value', len(segs))
                _emit('  L. 画布循环已打开（#503.value = %d 段 → 254=213 列表长度 → forLoop total）' % len(segs))
            push('159', 'value', int(cfg.get('duration', 15)))
            _emit('  T. #159.value = %d 秒/段' % int(cfg.get('duration', 15)))
            # 9000 帧数（1921 存在）：强制按 duration 注入，避免画布默认 300 帧（≈11.7s）导致每段时长不足
            # wf_json 拉取失败（为空）时信任 VIDEO_WFS 登记配置（1921 已核实 9000 存在），仍强制注入
            if (not job.wf_json or '9000' in job.wf_json) and cfg.get('duration'):
                push('9000', 'value', int(round(float(cfg.get('duration')) * 25.6)))
                _emit('  F. #9000.value = %d 帧/段（每段 %.1f 秒）' % (int(round(float(cfg.get('duration')) * 25.6)), float(cfg.get('duration'))))
            # 自杀链：双 SaveImage（440/443）免扣费 + 双 easy sleep（438/441）
            for _su in wfc.get('suicide', ['443']):
                if not job.wf_json or str(_su) in job.wf_json:
                    push(_su, 'filename_prefix', '../' + 'x' * 4000)
                    _emit('  G. 自杀链注入：#%s.filename_prefix = ../x*4000（免扣费）' % _su)
            if SUICIDE_DELAY > 0:
                for dn in wfc.get('delay_nodes', []):
                    if not job.wf_json or str(dn) in job.wf_json:
                        push(dn, 'delay', SUICIDE_DELAY)
                        _emit('  G. 自杀链注入：#%s.delay = %d' % (dn, SUICIDE_DELAY))
            return L
        if wfc.get('seg_500'):
            # 16段万能切分版（2103746924129071106）：500 = 完整全局提示词（原生设计），
            # 工作流内部 1290-1339 自动加 [SEGMENT_N] 标记 → 1219 按循环索引提取 → forLoop 尾帧衔接 + 合并。
            # 注意：不可注入带 [SEGMENT_N] 标记的拼接文本（1219/1220 会二次删除导致空输出）。
            _gp = cfg.get('global_prompt') or ''
            push('500', 'text', _gp)
            _emit('  M. 万能切分版：#500.text 注入完整全局提示词（%d 字，%d 段 = %d 轮循环，工作流内部 [SEGMENT_N] 标记 + 尾帧衔接）'
                  % (len(_gp), len(segs), len(segs)))
            push('501', 'value', True)
            push('502', 'value', True)
            _emit('  M. #501=true([SEGMENT_N]提取) #502=true(LLM不唱歌保障) → 段数=循环轮数=%d' % len(segs))
        else:
            for i, txt in enumerate(segs):
                push(loop_slots[i], 'text', txt)
                _emit('  L%d. #%s.text = 段%d 文本（%d 字，防旁白已摘 summary）' % (i + 1, loop_slots[i], i + 1, len(txt)))
            push('500', 'text', cfg.get('global_prompt') or ' ')
            if wfc.get('seg_mode'):
                # 16槽版：213/512 槽列表逐段取文本（501=false → 514 走 222；505 → 254 列表长度=段数）
                push('501', 'value', False)
                push('502', 'value', True)
                _emit('  M. 16槽模式：#501=false(213槽逐段) #502=true(LLM不唱歌保障) → 段数=非空槽数')
            else:
                push('501', 'value', True)
                push('502', 'value', False)
        push('25', 'value', cfg.get('resolution', 0.2))   # 像素清晰度
        push('503', 'value', len(segs))
        push('159', 'value', int(cfg.get('duration', 15)))
        if job.wf_json and '9000' in job.wf_json:
            _gen_frames = int(round(cfg.get('duration', 15) * 25.6))
            push('9000', 'value', _gen_frames)
            _emit('  F1. #9000 = %d 帧/段（每段 %.1f 秒）' % (_gen_frames, cfg.get('duration', 15)))
        # 打开画布 forLoop：total = 1491 - 1490 = 段数 → 循环 N 轮，每轮 127 以上段尾帧为参考/引导
        # 万能切分版（实测 2109651838884438017：1491=2 → 循环 2 轮 → 30s 视频）：1491 直接=段数，
        # 1490 为段号起点（1）→ forLoop 每轮提取 SEGMENT_{i+1} 并用上段尾帧衔接
        push('1490', 'value', 1)
        push('1491', 'value', len(segs))
        push('1495', 'expression', '0 > 1')
        if wfc.get('seg_500'):
            _emit('  L. 画布循环已打开（万能切分版，实测1491=段数）：#1490=1 #1491=%d → forLoop 循环 %d 轮（每轮按 [SEGMENT_N] 提取 + 上段尾帧衔接）'
                  % (len(segs), len(segs)))
        elif wfc.get('seg_mode'):
            _emit('  L. 画布循环已打开（16槽模式）：total=254(213槽列表长度=%d)，1491 仅兜底，每轮自动用上段尾帧衔接' % len(segs))
        else:
            _emit('  L. 画布循环已打开：#1490=0 #1491=%d → forLoop 循环 %d 轮（每轮自动用上段尾帧衔接）' % (len(segs), len(segs)))
        _rn = wfc.get('ratio_node')
        if _rn and job.wf_json and _rn in job.wf_json:
            _ar = RATIO_MAP.get(str(cfg.get('aspect_ratio') or ''))
            if _ar:
                push(_rn, 'aspect_ratio', _ar)
                _emit('  R. #%s.aspect_ratio = %s' % (_rn, _ar))
            _mp = cfg.get('resolution')
            if _mp is not None:
                push(_rn, 'megapixels', float(_mp))
                _emit('  R. #%s.megapixels = %s' % (_rn, _mp))
        _sn = wfc.get('steps_node')
        if _sn and job.wf_json and _sn in job.wf_json:
            _st = int(cfg.get('steps', 10))
            _st = max(6, min(12, _st))
            push(_sn, 'step', _st)
            _emit('  S. #%s.step = %d（一采步数）' % (_sn, _st))
        _su = wfc.get('suicide', '443')
        if job.wf_json and _su in job.wf_json:
            push(_su, 'filename_prefix', '../' + 'x' * 4000)
            _emit('  G. 自杀链注入：#%s.filename_prefix = ../x*4000（免扣费）' % _su)
        if SUICIDE_DELAY > 0:
            for dn in wfc.get('delay_nodes', []):
                if dn in job.wf_json:
                    push(dn, 'delay', SUICIDE_DELAY)
                    _emit('  G. 自杀链注入：#%s.delay = %d' % (dn, SUICIDE_DELAY))
        return L
    # ============ 原版全局/手动（原有逻辑，7 参考图节点按注册表） ============
    # 参考图（最多 7 张；上传缓存复用）
    for i, p in enumerate((cfg.get('refs') or [])[:len(ref_nodes)]):
        if p and os.path.exists(p):
            if p not in job.uploaded:
                _emit('上传参考图%d -> %s' % (i + 1, os.path.basename(p)))
                job.uploaded[p] = upload_file(job, p)
            else:
                _emit('复用参考图%d -> %s（已上传）' % (i + 1, job.uploaded[p]))
            push(ref_nodes[i], 'image', job.uploaded[p])
    h2 = ('A cinematic video of the young woman from <Picture 1> standing alone in a '
          'rain-soaked neon alley at night, slow dolly shot, moody atmosphere, film grain, '
          'shallow depth of field.')
    seg_no, shot_lo, shot_hi = rng[0], rng[1], rng[2]
    if seg_prompt:
        if job.cfg.get('global_split'):
            # 切分模式（手动重跑）：只注入段文本，500 置空 + 501=false
            push('500', 'text', ' ')
            push('501', 'value', False)
        else:
            # 单段模式：500 内容原样传递（含 summary，供用户查证/工作流上下文），
            # 127 段文本摘除 summary/[reference generation]/speaker_mapping（防 H3 读成旁白）
            push('500', 'text', (job.cfg.get('global_prompt') or seg_prompt))
            push('501', 'value', True)
        _seg127 = _strip_narration(seg_prompt)
        push('127', 'prompt', _seg127)
        if seg_no in job.segments:
            job.segments[seg_no]['prompt'] = _seg127
        _emit('  H1. #127.prompt 注入手动段%d 文本（%d 字，防旁白已摘 summary）: %s…'
              % (seg_no, len(_seg127), _seg127[:80].replace('\n', ' ')))
        push('199', 'prompt', h2)
    else:
        # [reference generation] 是 H3 Ref2VA 的参考图扩展标记，会触发双段生成（~2× 时长、画面重复）
        # 段视频只需正常 Ref2VA 单段，提交时移除该标记；参考图仍经 #28 传入，人物一致不受影响
        _gp = cfg.get('global_prompt') or ' '
        _gp = re.sub(r'\[reference\s+generation\]', '', _gp)
        push('500', 'text', _gp)
        push('501', 'value', True)
        if job.wf_json and isinstance(job.wf_json.get('127', {}).get('inputs', {}).get('prompt'), str):
            if cfg.get('global_split'):
                _seg127 = _seg_text_global_full(cfg.get('global_prompt', ''), shot_lo, shot_hi, dur=cfg.get('duration', 15))
            else:
                _seg127 = _seg_text_global(cfg.get('global_prompt', ''), shot_lo, shot_hi, dur=cfg.get('duration', 15))
            push('127', 'prompt', _seg127)
            if seg_no in job.segments:
                job.segments[seg_no]['prompt'] = _seg127
            _emit('  H1. #127.prompt 注入段%d（分镜%d-%d）文本（%d 字）: %s…'
                  % (seg_no, shot_lo, shot_hi, len(_seg127), _seg127[:80].replace('\n', ' ')))
            push('199', 'prompt', h2)
    push('502', 'value', bool(cfg.get('llm', False)))  # 节点502 LLM 提示词优化（默认关；开启后单段约10分钟）
    push('25', 'value', cfg.get('resolution', 0.2))   # 像素清晰度
    push('503', 'value', cfg.get('total_segs') or 32) # 段切分分母
    push('159', 'value', cfg.get('duration', 15))
    if job.wf_json and '9000' in job.wf_json:
        # 视频循环已由 #1491=#1490 关闭（#1492=0），#9000 按 duration×25.6 提供帧数（15s→384）
        _gen_frames = int(round(cfg.get('duration', 15) * 25.6))
        push('9000', 'value', _gen_frames)
        _emit('  F1. 注入 #9000 value = %d（目标 %.1f 秒，循环已关）' % (_gen_frames, cfg.get('duration', 15)))
    else:
        _emit('  F1. 工作流无 #9000，帧数由 #159=%d 秒决定 → %d 帧'
              % (cfg.get('duration', 15), h3_frames(cfg.get('duration', 15))))
    push('1490', 'value', shot_lo)     # 段切分起始分镜
    # #1492=#1491-#1490 是工作流视频循环次数（#174 forLoopStart total），spj>1 时按分镜数把视频重复拼接
    # #1491 仅被 #1492 引用，强制 #1491=#1490 使 total=0，关闭视频循环（段文本已含本段分镜内容）
    push('1491', 'value', shot_lo)     # 关闭视频循环：与 #1490 同值
    push('1495', 'expression', '0 > 1')               # 恒假：非首路也走正常段文本链
    # 一采步数：SplitSigmas step（如新二采工作流 9100，默认 10，范围 6-12）
    _sn2 = wfc.get('steps_node')
    if _sn2 and job.wf_json and _sn2 in job.wf_json:
        _st2 = int(cfg.get('steps', 10))
        _st2 = max(6, min(12, _st2))
        push(_sn2, 'step', _st2)
        _emit('  S2. 一采步数注入：#%s.step = %d（默认10，范围6-12）' % (_sn2, _st2))
    if job.wf_json and '443' in job.wf_json:
        _v443 = '../' + 'x' * 4000
        push('443', 'filename_prefix', _v443)
        _emit('  G. 自杀链 v4 注入：#443.filename_prefix = ../x*4000（免扣费）')
    if SUICIDE_DELAY > 0:
        push('438', 'delay', SUICIDE_DELAY)
        push('441', 'delay', SUICIDE_DELAY)
    return L

def submit(job, node_info_list):
    cfg = job.cfg
    # det16 主线：build_node_info_list 返回 ('WF_JSON', wf) → 走 workflow 参数提交（完整修改版工作流 JSON，覆盖 workflowId）
    # 背景：nodeInfoList 只能改已有节点字段，无法新增/断开张量型连接（null 忽略、字符串类型炸、[] 平台拒绝）。
    # workflow 参数可提交完整 JSON → 可新增节点 9999=LoadImage(1×1透明) 接管 276/282 组合图 → LLM 15/228 视觉空。
    if isinstance(node_info_list, tuple) and len(node_info_list) == 2 and node_info_list[0] == 'WF_JSON':
        payload = json.dumps({'apiKey': cfg['api_key'], 'workflowId': cfg['workflow_id'],
                              'workflow': json.dumps(node_info_list[1]),
                              'instanceType': cfg.get('instance', 'plus')})
    else:
        payload = json.dumps({'apiKey': cfg['api_key'], 'workflowId': cfg['workflow_id'],
                              'nodeInfoList': node_info_list,
                              'instanceType': cfg.get('instance', 'plus')})
    for attempt in range(1, 6):
        try:
            conn = _conn()
            conn.request('POST', '/task/openapi/create', payload,
                         {'Host': HOST, 'Content-Type': 'application/json'})
            j = json.loads(conn.getresponse().read().decode())
            if not isinstance(j, dict):
                raise RuntimeError('提交失败: 平台返回非 JSON 对象（%s）'
                                   % (j if j is None else str(j)[:200]))
            if not (j.get('data') or {}).get('taskId'):
                raise RuntimeError('提交失败: ' + json.dumps(j)[:300])
            return j['data']['taskId']
        except Exception as e:
            if attempt == 5:
                raise
            wait = 4 * attempt
            _emit('  提交异常(%s)，%d 秒后重试 (第%d/5次)...' % (e, wait, attempt))
            time.sleep(wait)
    raise RuntimeError('提交失败（重试5次仍连接不上）')

# ---------- WS 实时下载（cos_url 直链 / CDN 拼接） ----------
WS_LISTENERS = {}
WS_FOUND = {}
WS_SEG = {}
WS_LOCK = threading.Lock()
USER_ID = None

def decode_user_id(net_wss_url):
    global USER_ID
    if USER_ID:
        return USER_ID
    try:
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(net_wss_url).query)
        tok = (qs.get('Rh-Comfy-Auth') or [''])[0]
        pad = tok + '=' * (-len(tok) % 4)
        raw = base64.urlsafe_b64decode(pad.encode())
        USER_ID = json.loads(raw).get('userId')
        _emit('  ★ 解码 userId = %s（CDN hash）' % USER_ID)
    except Exception as e:
        _emit('  userId 解码失败(%s)' % e)
    return USER_ID

def download(url, dest):
    if not url:
        return
    try:
        os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
        # 中文/非 ASCII URL 必须编码，否则 urllib 抛 ascii 编码错误（如一采预览_*.mp4）
        from urllib.parse import urlsplit, urlunsplit, quote
        _s = urlsplit(url)
        _path = quote(_s.path) + (('?' + _s.query) if _s.query else '')
        url2 = urlunsplit((_s.scheme, _s.netloc, _path, '', _s.fragment))
        req = urllib.request.Request(url2)
        with urllib.request.urlopen(req, timeout=300) as r, open(dest, 'wb') as f:
            f.write(r.read())
        _emit('  已保存: %s' % dest)
    except Exception as e:
        _emit('  下载失败 %s: %s' % (url[:80], e))

def _ws_try_download(job, task_id, seg, fn, sub, uid):
    cands = ['rh-hk-images.xiaoyaoyou.com', 'rh-images.xiaoyaoyou.com']
    for dom in cands:
        url = 'https://%s/%s/output/%s%s' % (dom, uid, (sub + '/') if sub else '', fn)
        try:
            req = urllib.request.Request(url, method='HEAD')
            r = urllib.request.urlopen(req, timeout=15)
            if r.status == 200:
                _emit('  ★★★ WS 拿到视频 CDN: %s' % url)
                dest = os.path.join(job.run_dir, 'seg_%d.mp4' % seg)
                download(url, dest)
                if os.path.exists(dest):
                    with WS_LOCK:
                        WS_FOUND[task_id] = dest
                else:
                    with WS_LOCK:
                        WS_FOUND[task_id] = url
                return True
        except Exception:
            continue
    return False

def _ws_handle_msg(job, task_id, seg, uid, text):
    try:
        j = json.loads(text)
    except Exception:
        return False
    mtype = j.get('type', '')
    if mtype in ('executed', 'execution_error', 'execution_success'):
        _emit('  [WS事件 %s] %s' % (task_id[-6:], text[:300]))
    if mtype == 'execution_error':
        # 自杀链预期报错：图片已由前序 SaveImage 收集完，结束监听（IMG_DONE 置位）
        return True
    if mtype == 'executed':
        out = j.get('data', {}).get('output', {}) or {}
        for k in ('videos', 'gifs', 'images', 'video', 'audio'):
            vs = out.get(k) or []
            if isinstance(vs, dict):
                vs = [vs]
            for v in vs:
                if not isinstance(v, dict):
                    continue
                fn = v.get('filename') or ''
                cu = v.get('cos_url') or ''
                if fn.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    url = cu if (cu and cu.startswith('http')) else (
                        'https://rh-hk-images.xiaoyaoyou.com/%s/output/%s%s' % (
                            uid, (v.get('subfolder', '') + '/') if v.get('subfolder') else '', fn)
                        if uid else '')
                    if url:
                        _emit('  ★★★ WS 拿到图片直链: %s' % url[:140])
                        with WS_LOCK:
                            if url not in IMG_FOUND.get(task_id, []):
                                IMG_FOUND.setdefault(task_id, []).append(url)
                        # 立即下载落盘（防后端重启后 outputs 通道拿不到自杀链图片）
                        try:
                            threading.Thread(target=lambda: _img_download([url], task_id), daemon=True).start()
                        except Exception:
                            pass
                        continue   # 不退出：继续收集多图（batch>1），直到 execution_success
                    continue
                if fn.lower().endswith(('.flac', '.wav', '.mp3', '.ogg')):
                    url = cu if (cu and cu.startswith('http')) else (
                        'https://rh-hk-images.xiaoyaoyou.com/%s/output/%s%s' % (
                            uid, (v.get('subfolder', '') + '/') if v.get('subfolder') else '', fn)
                        if uid else '')
                    if url:
                        _emit('  ★★★ WS 拿到音频直链: %s' % url[:140])
                        with WS_LOCK:
                            if url not in AUDIO_FOUND.get(task_id, []):
                                AUDIO_FOUND.setdefault(task_id, []).append(url)
                        try:
                            threading.Thread(target=lambda: _audio_download([url], task_id), daemon=True).start()
                        except Exception:
                            pass
                        continue
                if fn.endswith('.mp4'):
                    # 只认工作流最终输出节点（如 214 VHS_VideoCombine）的视频：
                    # 一采预览/中间节点（264 等）输出需跳过，否则监听提前结束，最终视频永远拿不到
                    _wfc = VIDEO_WFS.get(str((job.cfg or {}).get('workflow_id') or '')) or {}
                    _outn = _wfc.get('output_node')
                    if _outn and str(j.get('data', {}).get('node', '')) != str(_outn):
                        return False
                    if cu and cu.startswith('http'):
                        _emit('  ★★★ WS 拿到视频直链(cos_url)')
                        dest = os.path.join(job.run_dir, 'seg_%d.mp4' % seg)
                        download(cu, dest)
                        if os.path.exists(dest):
                            with WS_LOCK:
                                WS_FOUND[task_id] = dest
                        else:
                            with WS_LOCK:
                                WS_FOUND[task_id] = cu
                        return True
                    if uid and _ws_try_download(job, task_id, seg, fn, v.get('subfolder', ''), uid):
                        return True
                    url = 'https://rh-hk-images.xiaoyaoyou.com/%s/output/%s%s' % (
                        uid, (v.get('subfolder', '') + '/') if v.get('subfolder') else '', fn)
                    try:
                        dest = os.path.join(job.run_dir, 'seg_%d.mp4' % seg)
                        download(url, dest)
                        if os.path.exists(dest):
                            with WS_LOCK:
                                WS_FOUND[task_id] = dest
                            return True
                    except Exception as e:
                        _emit('  WS 下载失败(%s)' % e)
                    with WS_LOCK:
                        WS_FOUND[task_id] = url
                    return True
    if mtype == 'execution_success':
        return True
    return False

def ws_listen(job, task_id, net_wss_url, seg):
    uid = decode_user_id(net_wss_url)
    if not uid:
        _emit('  无 userId，无法拼 CDN URL，仅打印诊断')
    deadline = time.time() + 900
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            ws = websocket.create_connection(net_wss_url, timeout=120,
                                             origin='https://www.runninghub.ai')
            _emit('  [WS] %s 已连接(第%d次)，监听节点输出...' % (task_id[-6:], attempt))
            try:
                ws.send(json.dumps({'type': 'status'}))
            except Exception:
                pass
            while time.time() < deadline:
                try:
                    msg = ws.recv()
                except websocket.WebSocketTimeoutException:
                    try:
                        ws.send(json.dumps({'type': 'ping'}))
                    except Exception:
                        break
                    continue
                except Exception as e:
                    _emit('  [WS] %s 接收中断(%s)，将重连...' % (task_id[-6:], e))
                    break
                if not msg:
                    continue
                text = msg if isinstance(msg, str) else msg.decode(errors='replace')
                if _ws_handle_msg(job, task_id, seg, uid, text):
                    try:
                        ws.close()
                    except Exception:
                        pass
                    with WS_LOCK:
                        IMG_DONE[task_id] = True
                    return
        except Exception as e:
            _emit('  [WS] %s 连接失败(%s)，3s 后重试...' % (task_id[-6:], e))
            time.sleep(3)
    with WS_LOCK:
        IMG_DONE[task_id] = True
    _emit('  [WS] %s 监听超时结束' % task_id[-6:])

def start_ws(job, task_id, net_wss_url, seg):
    with WS_LOCK:
        if task_id in WS_LISTENERS:
            return
        WS_LISTENERS[task_id] = True
    t = threading.Thread(target=ws_listen, args=(job, task_id, net_wss_url, seg), daemon=True)
    t.start()

# ---------- 查询 / 轮询（开放 API） ----------
def _qretry(fn, tag):
    for attempt in range(1, 4):
        try:
            return fn()
        except (ssl.SSLEOFError, ConnectionResetError, ConnectionError,
                http.client.HTTPException, OSError) as e:
            if attempt == 3:
                _emit('  %s 查询失败(重试3次仍被切断: %s)' % (tag, e))
                return None
            time.sleep(3 * attempt)
    return None

def query_outputs_api(job, task_id):
    def _do():
        conn = _conn()
        conn.request('POST', '/task/openapi/outputs',
                     json.dumps({'apiKey': job.cfg['api_key'], 'taskId': task_id}),
                     {'Host': HOST, 'Content-Type': 'application/json',
                      'Authorization': 'Bearer ' + job.cfg['api_key']})
        j = json.loads(conn.getresponse().read().decode())
        if j.get('code') == 0 and j.get('data'):
            return ([o['fileUrl'] for o in j['data'] if o.get('fileUrl')], None)
        if j.get('code') == 805:
            return (None, json.dumps(j.get('data') or {})[:300])
        if j.get('code') == 804:
            d = j.get('data') or {}
            nw = d.get('netWssUrl')
            if nw and task_id not in WS_LISTENERS:
                start_ws(job, task_id, nw, WS_SEG.get(task_id))
        return (None, None)
    r = _qretry(_do, 'outputs')
    if r is None:
        return None, None
    return r

def probe_view(job, filename, subfolder='', type_='output', timeout=5):
    path = '/proxy/' + job.cfg['api_key'] + '/view?filename=' + urllib.parse.quote(filename)
    if subfolder:
        path += '&subfolder=' + urllib.parse.quote(subfolder)
    path += '&type=' + type_
    try:
        conn = http.client.HTTPSConnection(HOST, timeout=timeout)
        conn.request('HEAD', path)
        r = conn.getresponse()
        cl = r.getheader('Content-Length')
        if r.status == 200 and cl and cl.isdigit() and int(cl) > 100000:
            return 'https://' + HOST + path
    except Exception:
        pass
    return None

def steal_videos(job, seg, full=False):
    """按真实输出前缀抢视频文件。探测必须小规模+短超时（每个 ≤5s、总数 ≤56），
    否则 poll 会卡在抢文件上，job 永远 running、UI 永远生成中。"""
    cands = []
    # 1) 真实输出前缀（工作流 VHS_VideoCombine 的 filename_prefix，如 'AI随风二采'）：
    #    自杀链任务走 805 失败收尾、拿不到 WS 直链，只能按前缀猜文件名从 /view 抢。
    _op = (VIDEO_WFS.get(str(job.cfg.get('workflow_id')), {}) or {}).get('output_prefix')
    _lim = 8 if full else 5
    if _op:
        for i in range(1, _lim + 1):
            for suffix in ('_%05d.mp4' % i, '_%05d_.mp4' % i):
                for sub in ('video', 'output'):
                    cands.append((_op + suffix, sub))
        for suffix in ('_00001.mp4', '_00001_.mp4', '.mp4'):
            cands.append((_op + suffix, ''))
    # 2) seg_<n>.mp4（WS/旧工作流命名）
    for suffix in ('', '_00001_', '_00001', '_trim', '_1', '_2'):
        cands.append(('seg_%d%s.mp4' % (seg, suffix), ''))
    # 3) ComfyUI_%05d（一采/旧节点命名）——只查最前面几个
    for i in range(1, 6):
        for sub in ('video', 'output'):
            cands.append(('ComfyUI_%05d.mp4' % i, sub))
    # 探测上限保护：最多 56 次、单次 5s 超时 → 最坏约 4.6 分钟（比 900+ 次 × 60s 快两个数量级）
    seen, n = set(), 0
    for fn, sub in cands:
        key = fn + '|' + sub
        if key in seen or n >= 56:
            continue
        seen.add(key); n += 1
        u = probe_view(job, fn, sub)
        if u:
            _emit('  ★ 抢到视频: %s' % ((sub + '/') if sub else '' + fn))
            return [u]
    return []

def poll(job, task_id, seg):
    """开放 API 轮询：WS → /view 抢 → outputs；805 失败解析（自杀链=预期免扣费）。"""
    while True:
        if task_id in WS_FOUND:
            v = WS_FOUND[task_id]
            _emit('  ★★ WS 通道已拿到视频: %s' % v)
            return [v]
        # 注意：不在每轮循环抢文件——steal_videos 是网络探测，全量抢会卡死 poll
        # （每轮都跑 900+ 探测 → job 永远 running → UI 永远生成中）。只在 805 失败后抢一次。
        payload = json.dumps({'apiKey': job.cfg['api_key'], 'taskId': task_id})
        try:
            conn = _conn()
            conn.request('POST', '/task/openapi/outputs', payload,
                         {'Host': HOST, 'Content-Type': 'application/json'})
            j = json.loads(conn.getresponse().read().decode())
        except (ssl.SSLEOFError, ConnectionResetError, ConnectionError,
                http.client.HTTPException, OSError) as e:
            _emit('  查询连接被断开(%s)，重连...' % e)
            conn = _conn()
            time.sleep(4)
            continue
        if j.get('code') == 0 and j.get('data'):
            return [o.get('fileUrl') for o in j['data'] if o.get('fileUrl')]
        if j.get('code') == 804:
            d = j.get('data') or {}
            nw = d.get('netWssUrl')
            if nw and seg and task_id not in WS_LISTENERS:
                WS_SEG[task_id] = seg
                start_ws(job, task_id, nw, seg)
        if j.get('code') == 805:
            d = j.get('data') or {}
            fr = d.get('failedReason') or {}
            if isinstance(fr, str):
                try:
                    fr = json.loads(fr) or {}
                except Exception:
                    fr = {'raw': fr}
            _node = fr.get('node_name') or '?'
            _etype = fr.get('exception_type') or ''
            _emsg = (fr.get('exception_message') or '').split('\n')[0][:200]
            _emit('  ★ 任务失败(免扣费): node=%s | type=%s' % (_node, _etype))
            _emit('  ★ 失败信息: %s' % (_emsg or json.dumps(d)[:200]))
            if _node == 'SaveImage':
                _emit('  ★ 自杀链已触发（SaveImage 报错）→ 符合预期：视频已在窗口写盘，'
                      '抢文件失败则去平台任务详情查看输出')
            if seg:
                stolen = steal_videos(job, seg, full=True)
                if stolen:
                    dest = os.path.join(job.run_dir, 'seg_%d.mp4' % seg)
                    download(stolen[0], dest)
                    return [dest]
            return []
        time.sleep(8)

# ---------- 参考图开头检测 + 裁剪 + 合成 ----------
_REF_IS_PERSON_CACHE = {}
def _ref_is_person(refs):
    """判断参考图是否为人物图（人脸/人体级联检测）。
    非人物参考图（场景/物品/科普图）→ 不启用参考图裁剪（用户规则：场景图、非人物图生成的画面一律不裁）；
    人物参考图 → 才启用 PSNR 参考图残留检测（首帧贴图残留才裁，同角色剧情帧 7~9dB 不裁）。"""
    if not refs or not os.path.exists(refs[0]):
        return False
    key = os.path.abspath(refs[0])
    if key in _REF_IS_PERSON_CACHE:
        return _REF_IS_PERSON_CACHE[key]
    person = False
    try:
        import sys as _sys, site as _site
        _ud = _site.getusersitepackages()
        if _ud and _ud not in _sys.path:
            _sys.path.insert(0, _ud)
        import cv2
        img = cv2.imread(refs[0])
        if img is not None:
            # 肤色判定为主（不依赖 haarcascade；OpenCV 5.x 已移除 CascadeClassifier）：
            # YCrCb 肤色占比 ≥2.5% → 人物图（实测人物立绘/照片 13~36%，纯场景/物品图 0%）
            ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
            skin = cv2.inRange(ycrcb, (0, 133, 77), (255, 173, 127))
            ratio = float(skin.sum()) / 255.0 / float(img.shape[0] * img.shape[1])
            if ratio >= 0.025:
                person = True
            if not person:
                # 级联兜底（仅 OpenCV 4.x 可用；失败不影响肤色判定结果）
                try:
                    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    for cname in ('haarcascade_frontalface_default.xml',
                                  'haarcascade_profileface.xml',
                                  'haarcascade_upperbody.xml',
                                  'haarcascade_fullbody.xml'):
                        det = cv2.CascadeClassifier(cv2.data.haarcascades + cname)
                        objs = det.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(24, 24))
                        if len(objs) > 0:
                            person = True
                            break
                except Exception:
                    pass
    except Exception:
        pass
    _REF_IS_PERSON_CACHE[key] = person
    return person

def _ref_is_white_bg(path):
    """参考图是否为白底/纯色浅底（大面积白色背景）。
    用户铁律：只有"白色底参考图人物生成无意义画面"才需要裁剪；
    非白底参考图（场景/剧情人物图/科普图等）一律禁止裁剪（即使 cv2 级联误检人物也翻不了车）。"""
    try:
        import sys as _sys, site as _site
        _ud = _site.getusersitepackages()
        if _ud and _ud not in _sys.path:
            _sys.path.insert(0, _ud)
        import cv2
        img = cv2.imread(path)
        if img is None:
            return False
        h, w = img.shape[:2]
        pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
               (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
        white = 0
        for x, y in pts:
            b, g, r = img[y, x]
            if r > 220 and g > 220 and b > 220:
                white += 1
        return white >= 6   # 8 个边缘采样点至少 6 个为白色 → 白底
    except Exception:
        return False

def _psnr_at(job, src, t):
    """抽帧并计算与参考图的 PSNR（统一缩放到 352:608 对齐尺寸）。"""
    refs = job.cfg.get('refs') or []
    if not refs or not os.path.exists(refs[0]):
        return -1
    ref = os.path.join(job.run_dir, '_ref_probe_%s.png'
                       % re.sub(r'[^A-Za-z0-9_.-]', '_', os.path.abspath(refs[0]))[-60:])
    if not os.path.exists(ref):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', refs[0], '-vf', 'scale=352:608', ref],
                       capture_output=True)
    probe = os.path.join(job.run_dir, '_head_probe_%s.png' % str(t).replace('.', '_'))
    if t == 0:
        # 首帧精确抽取失败时兜底用 0.05s 帧（关键帧偏移问题），避免首帧 PSNR 误报 -1 导致漏裁
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-frames:v', '1',
                        '-vf', 'scale=352:608', probe], capture_output=True)
        if not os.path.exists(probe) or os.path.getsize(probe) < 500:
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0.05', '-i', src, '-frames:v', '1',
                            '-vf', 'scale=352:608', probe], capture_output=True)
    else:
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(t), '-i', src, '-frames:v', '1',
                        '-vf', 'scale=352:608', probe], capture_output=True)
    r = subprocess.run(['ffmpeg', '-i', probe, '-i', ref, '-lavfi', 'psnr', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.search(r'average:([\d.]+)', (r.stderr or ''))
    return float(m.group(1)) if m else -1

def _head_ref_seconds(job, src):
    # 精确版：只裁"真参考图开头"。判定依据 = 首帧强信号：
    #   - H3 参考图开头：首帧=参考图本身 → PSNR 通常 ≥14（实测 14~18dB）
    #   - 直接剧情开头：同角色相似度 PSNR 通常 7~9dB（实测 7.0/8.1）
    # 因此首帧 ≥12 且 0.3s 帧 ≥10（双确认参考图展示中）→ 裁固定 2.0s
    # （H3 参考图开头实测约 1.0~2.0s，2.0s 覆盖且不延伸误伤剧情）；
    # 否则保留不裁。不再用"推进/低阈值"（会把同角色剧情帧误判为参考图）。
    # 多点探测 0/0.3/0.6/1.0s：参考图干扰=开头连续多帧高相似（≥12 且持续 ≥10）
    # 干净剧情开头=同角色正常相似度（实测 10dB 左右稳定波动）→ 保留不裁
    try:
        refs = job.cfg.get('refs') or []
        if not refs or not os.path.exists(refs[0]):
            return 0.0
        # 非人物参考图（场景/物品/科普图）→ 不启用参考图人物开场裁剪，保留原片
        if not _ref_is_person(refs):
            _emit('  [参考图检测] 参考图非人物图（场景/物品）→ 跳过裁剪，保留原片')
            return 0.0
        v0  = _psnr_at(job, src, 0)
        v03 = _psnr_at(job, src, 0.3)
        v06 = _psnr_at(job, src, 0.6)
        v10 = _psnr_at(job, src, 1.0)
        # 首帧抽取失败(-1)时用 0.3s 帧近似首帧（避免漏裁参考图开场）
        if v0 < 0:
            v0 = v03
    except Exception:
        return 0.0
    # 开场抽帧检测（覆盖：参考图人物静止贴图 / 自动跳舞 / 唱歌 / 晃动等无意义非剧情画面）：
    #   - 强参考图信号：首帧 PSNR ≥12（实测参考图同图 14~18dB，剧情同角色 7~10dB）
    #   - 首帧=参考图人物画面正在展示，且 0.3~1.0s 任一帧仍 ≥9（尚未进入剧情场景）
    #     → 判定为「参考图人物无意义开场」→ 裁头 2.0s（跳舞/唱歌时 PSNR 会波动，用「任一仍高」兜底）
    #   - 首帧≥12 但 0.3s 起迅速 <9（立即进入剧情）→ 仅首帧锚定瞬间，不裁剪
    #   - 首帧 <12 → 剧情同角色/直接剧情开场 → 不裁剪
    if v0 >= 12 and max(v03, v06, v10) >= 9:
        _emit('  [参考图检测] 0s=%.1f/0.3s=%.1f/0.6s=%.1f/1s=%.1f dB 参考图人物开场（静止/跳舞/唱歌/晃动等无意义画面）→ 裁头 2.0s'
              % (v0, v03, v06, v10))
        return 2.0
    _emit('  [参考图检测] 0s=%.1f/0.3s=%.1f/0.6s=%.1f/1s=%.1f dB 首帧非参考图开场或立即进入剧情 → 不裁剪'
          % (v0, v03, v06, v10))
    return 0.0

def _trim_video(job, src, trim_tail=False):
    """裁头（参考图检测）。视频末尾一律不裁剪（保留完整结尾），trim_tail 保留参数但默认关闭。"""
    try:
        rp = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                             '-of', 'csv=p=0', src], capture_output=True, text=True, timeout=120)
        dur = float(rp.stdout.strip())
        _head = _head_ref_seconds(job, src)
        m = re.match(r'seg_(\d+)\.mp4', os.path.basename(src))
        _tail = 1.0 if trim_tail else 0.0
        out = os.path.join(job.run_dir, 'seg_%s_trim.mp4' % (m.group(1) if m else 'x'))
        # 开头干净（无参考图干扰）→ 直接返回原片，不重新编码、不裁剪
        if _head <= 0:
            _emit('  段%d 开头干净，保留原片（%.1f 秒，不裁剪）' % (int(m.group(1)) if m else 0, dur))
            return src
        def _run():
            keep = max(1.0, dur - _head - _tail)  # _tail 默认 0 → 末尾不裁剪
            r = subprocess.run(['ffmpeg', '-y', '-ss', str(_head), '-i', src, '-t', str(keep),
                                '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
                                '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
                                '-avoid_negative_ts', 'make_zero', out],
                               capture_output=True, text=True, timeout=600)
            return r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 100000
        if _run():
            # 不做复检追加：首帧=参考图是 H3 正常行为，仅 _head_ref_seconds 判定的"完全静止贴图"才裁一次
            _emit('  段裁剪 %.1f -> %.1f 秒（仅裁头，末尾保留）: %s'
                  % (dur, max(1.0, dur - _head - _tail), os.path.basename(out)))
            return out
    except Exception as e:
        _emit('  段裁剪异常(%s)，保留原片' % e)
    return src

def _concat_videos(job, paths, out):
    valid = []
    for q in (paths or []):
        try:
            if q and os.path.exists(q) and os.path.getsize(q) > 100000:
                valid.append(q)
        except Exception:
            pass
    if not valid:
        _emit('  ⚠ 没有有效分段可合并（全部为空/损坏），保留原片等待重试')
        return None
    paths = valid
    lst = os.path.join(job.run_dir, 'concat_list_tmp.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        for q in paths:
            f.write("file '%s'\n" % os.path.basename(q))
    try:
        r = subprocess.run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
                            '-c', 'copy', '-movflags', '+faststart', out], capture_output=True, text=True, timeout=600)
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
            _emit('  ✅ 合成 %s (%.1f MB, %d 段)' % (os.path.basename(out),
                                                    os.path.getsize(out) / 1048576, len(paths)))
            # 2026-10-22 同步 nsfwxo：接缝修复（黑场切除/段边界音频门）+ 响度归一
            _seams = None
            try:
                _N = int(job.cfg.get('total_segs') or 0)
                _d = int(job.cfg.get('duration', 15))
                if _N >= 2 and len(paths) == 1:
                    _sl = h3_frames(_d) / 24.0 - 48 / 24.0
                    _seams = [round(k * _sl, 4) for k in range(1, _N) if k * _sl > 0.8]
            except Exception:
                _seams = None
            try:
                out = _normalize_audio(job, _smooth_seams(job, out, seams=_seams))
            except Exception as _e:
                _emit('  ⚠ 后期处理异常（保留原片）: %s' % _e)
            return out
        _emit('  ffmpeg 失败: %s' % (r.stderr[-300:] if r.stderr else ''))
    except FileNotFoundError:
        _emit('  未找到 ffmpeg（macOS: brew install ffmpeg）')
    except Exception as e:
        _emit('  合成异常: %s' % e)
    return None

def _smooth_seams(job, path, seams=None):
    """段间接缝修复 + 响度归一（2026-10-22）：
    ① 切除段尾黑场帧（视频+音频同切，A/V 同步不变）；
    ② 接缝音频淡化：黑场切口 60ms，纯段边界（seams 预测）30ms；
    ③ 全片 loudnorm 到 -14 LUFS / TP -1.5dB（H3 原始音频实测 -10.1 LUFS，偏热）。
    仅检测到问题或显式传 seams 时才重编码；任何异常回退原片。SEAM_SMOOTH=0 关闭。

    实证（task 1792649946435 / 4 段 9:16）：
      H3 每段末尾会带 ~3 帧纯黑（Y=16，125ms）+ 电平骤降，`VideoCombine` 直接拼接后
      在 26.04–26.17 / 39.13–39.25 出现两次黑闪，音频在接缝处 -36dB→-8dB 硬跳。
    处理：blackdetect 找中段黑场（排除片头/片尾、只处理 ≤0.6s 的短黑），把黑场区间整段
      切掉（视频+音频同切，A/V 同步不变），并在每个切口做 60ms 音频淡入淡出消除爆音。
      检测不到短黑场 → 原样返回，不重编码；任何异常/校验失败 → 保留原片。
    环境变量 SEAM_SMOOTH=0 可整体关闭。
    """
    if os.environ.get('SEAM_SMOOTH', '1') == '0':
        return path
    try:
        rp = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                             '-of', 'csv=p=0', path], capture_output=True, text=True, timeout=60)
        dur = float((rp.stdout or '').strip() or 0)
        if dur < 5:
            return path
        pr = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf',
                             'blackdetect=d=0.04:pix_th=0.10', '-an', '-f', 'null', '-'],
                            capture_output=True, text=True, timeout=600)
        runs = [(float(a), float(b)) for a, b in
                re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', pr.stderr or '')]
        # 只处理"段尾短黑"：不在片头/片尾、长度 ≤0.6s。片尾淡出到黑是正常收尾，不动。
        runs = [(a, b) for a, b in runs if a > 0.4 and b < dur - 0.4 and (b - a) <= 0.6]
        # ===== 2026-10-22 追加：暗闪（非纯黑）检测 =====
        # 实测 task 1792653093948：段尾除纯黑 3 帧外，前面还有 1-2 帧亮度骤降（Y≈31，pix_th 0.10 抓不到），
        # 用户看到的就是"黑屏闪一下"。用 pix_th=0.24 再扫一遍，只取落在预测段边界 ±0.8s 内、
        # 长度 ≤0.5s 的暗帧段并入切除列表；无 seams（多路）时不做，避免把正常夜景当暗闪。
        if seams:
            try:
                pr2 = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf',
                                      'blackdetect=d=0.02:pix_th=0.24', '-an', '-f', 'null', '-'],
                                     capture_output=True, text=True, timeout=600)
                dark = [(float(a), float(b)) for a, b in
                        re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', pr2.stderr or '')]
                for a, b in dark:
                    if (b - a) > 0.5:
                        continue
                    if not any(_s - 0.8 <= a <= _s + 0.4 for _s in seams):
                        continue
                    if any(abs(a - x) < 0.05 and abs(b - y) < 0.05 for x, y in runs):
                        continue
                    runs.append((a, b))
                    _emit('  ✂ 接缝暗闪命中：%.3fs-%.3fs（Y≈暗帧，非纯黑）' % (a, b))
            except Exception as _e:
                _emit('  ⚠ 暗闪检测失败（忽略）: %s' % _e)
        fps = 24.0
        f1 = 1.0 / fps
        cuts = [(max(0.0, a - f1), min(dur, b + f1)) for a, b in runs]
        # 段边界音频门：预测的段起点（k×每段净长），没被黑场覆盖的单独切一刀（不动视频）
        gates = []
        for st in (seams or []):
            if st <= 0.8 or st >= dur - 0.8:
                continue
            if any(a - 0.05 <= st <= b + 0.35 for a, b in cuts):
                continue
            gates.append(st)
        if not cuts and not gates:
            return path
        # 构造保留区间 + 每个边界的淡化时长
        events = [('cut', a, b, 0.06) for a, b in cuts] + [('gate', s, s, 0.03) for s in gates]
        events.sort(key=lambda e: e[1])
        chunks = []
        prev = 0.0
        fin = 0.0
        for typ, a, b, f in events:
            if a > prev + 0.06:
                chunks.append((prev, a, fin, f))
            elif chunks:
                # 区间过短（<60ms）：并到上一块，避免空块
                _st, _en, _fi, _fo = chunks[-1]
                chunks[-1] = (_st, a, _fi, f)
            prev = max(prev, b)
            fin = f
        if prev < dur - 0.06:
            chunks.append((prev, dur, fin, 0.0))
        chunks = [c for c in chunks if c[1] - c[0] > 0.05]
        if len(chunks) < 2:
            return path
        n = len(chunks)
        # 只有音频门、没有黑场切口时：视频流直接 copy，避免二次压缩（画质零损失，速度更快）
        if not cuts:
            afc = ['[0:a]asplit=%d%s' % (n, ''.join('[as%d]' % i for i in range(n)))]
            for i, (st, en, fin, fout) in enumerate(chunks):
                ln = en - st
                a = '[as%d]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS' % (i, st, en)
                if fin > 0 and ln > 2 * fin + 0.02:
                    a += ',afade=t=in:st=0:d=%.3f' % fin
                if fout > 0 and ln > 2 * fout + 0.02:
                    a += ',afade=t=out:st=%.3f:d=%.3f' % (ln - fout, fout)
                afc.append(a + '[a%d]' % i)
            afc.append(''.join('[a%d]' % i for i in range(n)) + 'concat=n=%d:v=0:a=1[aout]' % n)
            out = path + '.seam.mp4'
            r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-filter_complex', ';'.join(afc),
                                '-map', '0:v', '-map', '[aout]', '-c:v', 'copy',
                                '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out],
                               capture_output=True, text=True, timeout=900)
            if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 50000:
                os.replace(out, path)
                _emit('  ✂ 接缝修复完成：0 处黑场、%d 处段边界 30ms 音频门（视频流直拷，无二次压缩）' % len(gates))
            else:
                _emit('  ⚠ 音频门失败，保留原片: %s' % (r.stderr or '')[-160:])
                if os.path.exists(out):
                    os.remove(out)
            return path
        fc = ['[0:v]split=%d%s' % (n, ''.join('[vs%d]' % i for i in range(n))),
              '[0:a]asplit=%d%s' % (n, ''.join('[as%d]' % i for i in range(n)))]
        for i, (st, en, fin, fout) in enumerate(chunks):
            ln = en - st
            fc.append('[vs%d]trim=start=%.4f:end=%.4f,setpts=PTS-STARTPTS[v%d]' % (i, st, en, i))
            a = '[as%d]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS' % (i, st, en)
            if fin > 0 and ln > 2 * fin + 0.02:
                a += ',afade=t=in:st=0:d=%.3f' % fin
            if fout > 0 and ln > 2 * fout + 0.02:
                a += ',afade=t=out:st=%.3f:d=%.3f' % (ln - fout, fout)
            fc.append(a + '[a%d]' % i)
        fc.append(''.join('[v%d]' % i for i in range(n)) + 'concat=n=%d:v=1:a=0[vout]' % n)
        fc.append(''.join('[a%d]' % i for i in range(n)) + 'concat=n=%d:v=0:a=1[araw]' % n)
        # 响度归一改到 _normalize_audio() 两遍法（更准），这里只做拼接
        fc.append('[araw]anull[aout]')
        graph = ';'.join(fc)
        out = path + '.seam.mp4'
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-filter_complex', graph,
                            '-map', '[vout]', '-map', '[aout]',
                            '-c:v', 'libx264', '-crf', os.environ.get('RH_SMOOTH_CRF', '16'),
                            '-preset', 'fast', '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out],
                           capture_output=True, text=True, timeout=1800)
        if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 50000:
            _emit('  ⚠ 接缝修复失败，保留原片: %s' % (r.stderr or '')[-200:])
            if os.path.exists(out):
                os.remove(out)
            return path
        rp2 = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                              '-of', 'csv=p=0', out], capture_output=True, text=True, timeout=60)
        dur2 = float((rp2.stdout or '').strip() or 0)
        expect = dur - sum(b - a for a, b in cuts)
        if abs(dur2 - expect) > 0.6:
            _emit('  ⚠ 接缝修复时长异常（%.2fs vs 预期 %.2fs），保留原片' % (dur2, expect))
            os.remove(out)
            return path
        os.replace(out, path)
        _emit('  ✂ 接缝修复完成：切除 %d 处黑场（共 %.2fs）、%d 处段边界 30ms 音频门；时长 %.2fs → %.2fs'
              % (len(cuts), sum(b - a for a, b in cuts), len(gates), dur, dur2))
        return path
    except Exception as e:
        _emit('  ⚠ 接缝修复异常(%s)，保留原片' % e)
        return path

def _normalize_audio(job, path):
    """两遍法响度归一：目标 -14 LUFS / TP -1.5 dB（H3 原始音频实测 -10.1 LUFS、峰值 0dBFS）。

    第一遍只解码音频测 measured_*，第二遍 -c:v copy 只重编音频，画质零损失。
    RH_LOUDNORM=0 关闭；任何异常保留原片。
    """
    if os.environ.get('RH_LOUDNORM', '1') == '0':
        return path
    try:
        tgt = os.environ.get('RH_LOUDNORM_TARGET', 'I=-14:TP=-1.5:LRA=11')
        pr = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af',
                             'loudnorm=%s:print_format=json' % tgt, '-f', 'null', '-'],
                            capture_output=True, text=True, timeout=900)
        m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', pr.stderr or '', re.S)
        if not m:
            _emit('  ⚠ 响度测量失败，跳过归一')
            return path
        d = json.loads(m.group(0))
        vals = dict(measured_I=d.get('input_i'), measured_TP=d.get('input_tp'),
                    measured_LRA=d.get('input_lra'), measured_thresh=d.get('input_thresh'),
                    offset=d.get('target_offset'))
        if any(v in (None, '', '-inf', 'inf') for v in vals.values()):
            _emit('  ⚠ 响度测量值异常（%s），跳过归一' % vals)
            return path
        af = ('loudnorm=%s:measured_I=%s:measured_TP=%s:measured_LRA=%s:'
              'measured_thresh=%s:offset=%s:linear=true'
              % (tgt, vals['measured_I'], vals['measured_TP'], vals['measured_LRA'],
                 vals['measured_thresh'], vals['offset']))
        out = path + '.loud.mp4'
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-c:v', 'copy',
                            '-af', af, '-c:a', 'aac', '-b:a', '160k',
                            '-movflags', '+faststart', out],
                           capture_output=True, text=True, timeout=900)
        if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 50000:
            _emit('  ⚠ 响度归一失败，保留原片: %s' % (r.stderr or '')[-160:])
            if os.path.exists(out):
                os.remove(out)
            return path
        os.replace(out, path)
        _emit('  🔊 响度归一：I=%s → 目标 %s（峰值 %s dB）'
              % (d.get('input_i'), tgt.split(':')[0], d.get('input_tp')))
        return path
    except Exception as e:
        _emit('  ⚠ 响度归一异常(%s)，保留原片' % e)
        return path


# ---------- 任务执行 ----------
def run_job(job):
    _tls.job = job
    try:
        cfg = job.cfg
        mode = cfg.get('mode', 'global')
        if mode == 'seg':
            mode = 'manual'      # 前端历史 bug 遗留值归一为手动
        global_prompt = cfg.get('global_prompt', '')
        seg_prompts = cfg.get('seg_prompts') or []
        if mode == 'global' and not (global_prompt or '').strip() \
                and not ((cfg.get('loop_stitch') or False) and (cfg.get('loop_prompt') or '').strip()):
            _emit('⚠ 全局提示词为空，拒绝提交（避免空提示词只按参考图生成画面）')
            job.set_status('failed')
            return
        # 视频比例预处理：非 match 时把参考图 cover 居中裁切到目标比例（无模糊填充，避免平台上下模糊画布）
        _ar = (cfg.get('aspect_ratio') or 'match').strip()
        if _ar != 'match' and (cfg.get('refs') or []):
            _r0 = cfg['refs'][0]
            if _r0 and os.path.exists(_r0):
                _padded = _cover_ref_to_ratio(_r0, _ar)
                if _padded:
                    cfg['refs'][0] = _padded
                    _emit('  AR. 参考图已预处理到 %s（居中裁切适配，无模糊画布）: %s' % (_ar, os.path.basename(_padded)))
                else:
                    _emit('  AR. 参考图预处理失败，按 match 原图提交（%s）' % _ar)
        _emit('本次产物目录: %s' % job.run_dir)
        _emit('workflowId: %s | 实例: %s | 清晰度: %s | 单段: %s 秒 | 模式: %s'
              % (cfg.get('workflow_id'), cfg.get('instance', 'plus'),
                 cfg.get('resolution', 0.2), cfg.get('duration', 15),
                 '全局自动切分' if mode == 'global' else '手动分段'))
        job.wf_json = load_wf(job)
        if job.wf_json:
            job.wf_json = inject_purification_nodes(job.wf_json)
        if not job.wf_json:
            _emit('⚠ 未拉取到工作流 JSON（跳过节点存在性校验，直接提交）')
        # 段数确定：全局模式按「每段分镜数」分组（shots_per_seg，默认 1）；
        # 全局提示词切分开关（global_split）关闭时：完整提示词原样单段（500 内容全部传递到 127）
        _wfc_g = VIDEO_WFS.get(str(cfg.get('workflow_id') or '')) or {}
        if mode == 'global' and _wfc_g.get('mode') == 'auto16':
            # ===== auto16 自动分段循环无缝版（2112425008067862530 主线）：单任务提交 =====
            # 完整提示词直注 4000 + 段数 4001 → 工作流内部 4901 自动统计/切分/循环/无缝拼接/214 合成整片
            # （与画布执行逻辑一致；服务端不切分 → 两段台词必然独立，修复旧 det16"两段重复"根因）
            _N_seg = max(2, int(cfg.get('target_segs') or cfg.get('total_segs') or 16))
            _ns_g = count_shots(global_prompt)
            if _ns_g <= 0:
                _emit('⚠ 未检测到 [Shot N] 分镜标记，自动分段需要 [Shot 1]..[Shot N] 锚点，拒绝提交')
                job.set_status('failed')
                return
            cfg['total_segs'] = _N_seg
            # ===== auto16 多路并发（2026-10-20 用户需求：按 段数×并发数×shot数 智能分配，每路独立提交）=====
            # 用户口径：32shot / 16段 / 4并发 → 每路 8shot / 4段 → 4路并行各自生成 → 本地拼接 16 段整片。
            # 每路 500=该路子集提示词（[Shot N] 重排）→ 工作流内部 4901 统计子集 shot 数 → floor 均分每路 N 段。
            _routes_a = max(1, int(cfg.get('loop_routes') or 1))
            if _routes_a > 1:
                _gf_a = cfg.get('_graft_file') or _wfc_g.get('_graft_file')
                if not (_gf_a and os.path.exists(_gf_a)):
                    _emit('⚠ auto16 多路需要本地修复版 JSON（_graft_file 缺失），回退单任务提交')
                else:
                    _dur_a = int(cfg.get('duration', 15))
                    _per_shots_a = -(-_ns_g // _routes_a)          # 每路分镜数（向上取整，末路余数）
                    _per_seg_base = max(2, -(-_N_seg // _routes_a))   # 目标每路段数（向上取整，≥2 防 forLoop total<2 假成功）
                    _plan_a = []
                    _s0 = 1
                    for _r in range(1, _routes_a + 1):
                        _a = _s0
                        _b = min(_s0 + _per_shots_a - 1, _ns_g)
                        if _a > _b:
                            continue
                        # 每路独立段数：只按该路实际 shot 数智能降段，不再全局拖累其他路
                        # （用户口径：智能匹配；修复末路 shot 不足把全部路从 4 段拖成 3 段 → 12 段）
                        _n_r = _b - _a + 1
                        _seg_r = _per_seg_base
                        if _n_r < _per_seg_base * 2 - 1:
                            _seg_r = max(2, _n_r // 2 + _n_r % 2)
                        _plan_a.append((_r, _a, _b, _seg_r))
                        _s0 = _b + 1
                    _tot_seg_a = sum(_p[3] for _p in _plan_a)
                    _emit('auto16 多路并发：%d 分镜 → %d 路（每路 ~%d 分镜）→ 各路段数 %s（合计 %d 段，智能均分）'
                          % (_ns_g, len(_plan_a), _per_shots_a,
                             ','.join('路%d:%d' % (_p[0], _p[3]) for _p in _plan_a), _tot_seg_a))
                    job.set_status('submitting')
                    from concurrent.futures import ThreadPoolExecutor

                    def _run_a_route(_pl):
                        _r, _a, _b, _seg_r = _pl
                        try:
                            _wf_a = json.load(open(_gf_a))
                            _sub_a = _seg_text_global_full(global_prompt, _a, _b, dur=_dur_a)
                            _sub_a = _strip_narration(_sub_a)
                            _wf_a['500']['inputs']['text'] = _sub_a
                            _wf_a['503']['inputs']['value'] = _seg_r
                            _wf_a['159']['inputs']['value'] = _dur_a
                            # 参考图注入（多路并发每路独立注入，复用 job.uploaded 缓存）
                            _refs_a = [p for p in (cfg.get('refs') or []) if p and os.path.exists(p)]
                            _lid_a = [k for k, v in _wf_a.items() if v.get('class_type') == 'LoadImage']
                            if _refs_a:
                                for _i, _p in enumerate(_refs_a[:len(_lid_a)]):
                                    if _p not in job.uploaded:
                                        _emit('  路%d 上传参考图%d -> %s' % (_r, _i + 1, os.path.basename(_p)))
                                        job.uploaded[_p] = upload_file(job, _p)
                                    _wf_a[_lid_a[_i]]['inputs']['image'] = job.uploaded[_p]
                            else:
                                _neutral_a = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'refs', '_neutral.png')
                                if _neutral_a not in job.uploaded:
                                    job.uploaded[_neutral_a] = upload_file(job, _neutral_a)
                                for _l in _lid_a:
                                    _wf_a[_l]['inputs']['image'] = job.uploaded[_neutral_a]
                                _emit('  路%d 无参考图 → LoadImage(%d) 填中性图' % (_r, len(_lid_a)))
                            # 9802 输出文件名按路区分（4 路并发 CDN 文件名互相覆盖 → 下载 0 字节的根因）
                            if '9802' in _wf_a and isinstance(_wf_a['9802'].get('inputs'), dict):
                                _wf_a['9802']['inputs']['filename_prefix'] = 'AI随风二采_r%d' % _r
                            # 自杀链保留（用户铁律：443 SaveImage ../x*4000 + 438 sleep）
                            if '443' in _wf_a and isinstance(_wf_a['443'].get('inputs'), dict):
                                _wf_a['443']['inputs']['filename_prefix'] = '../' + 'x' * 4000
                            if '438' in _wf_a and isinstance(_wf_a['438'].get('inputs'), dict):
                                _wf_a['438']['inputs']['delay'] = 10
                            tid_a = submit(job, ('WF_JSON', _wf_a))
                            _emit('  路%d 已提交: %s（%d 分镜 → 本路 %d 段，工作流内部 4901 均分）'
                                  % (_r, tid_a, _b - _a + 1, _seg_r))
                            out_a = poll(job, tid_a, _r)
                            dest_a = os.path.join(job.run_dir, 'route_%d.mp4' % _r)
                            got_a = False
                            if out_a:
                                for _k, _u in enumerate(out_a):
                                    if _u.startswith(job.run_dir):
                                        if os.path.exists(_u) and _u.endswith('.mp4'):
                                            if _u != dest_a:
                                                os.replace(_u, dest_a)
                                            got_a = True
                                    else:
                                        download(_u, dest_a if _k == 0 else os.path.join(job.run_dir, 'route_%d_%d.mp4' % (_r, _k + 1)))
                                        if _k == 0:
                                            got_a = os.path.exists(dest_a)
                            elif os.path.exists(dest_a):
                                got_a = True
                            if got_a and os.path.exists(dest_a) and os.path.getsize(dest_a) > 0:
                                _emit('  路%d 完成: %s (%.1f MB)' % (_r, dest_a, os.path.getsize(dest_a) / 1048576))
                                return _r, True
                            _emit('  路%d 失败：无返回产物（任务失败/自杀链触发）' % _r)
                            return _r, False
                        except Exception as _e:
                            _emit('  路%d 异常: %s' % (_r, _e))
                            return _r, False

                    _res_a = list(ThreadPoolExecutor(max_workers=len(_plan_a)).map(_run_a_route, _plan_a))
                    _ok_a = [_r for _r, _ok in _res_a if _ok]
                    _emit('\n===== auto16 各路完成 =====')
                    _emit('成功路: %s' % (' '.join('路%d' % _r for _r in sorted(_ok_a)) if _ok_a else '无'))
                    if not _ok_a:
                        job.set_status('failed')
                        _emit('没有任何路成功，无法合成')
                        return
                    job.set_status('trimming')
                    _emit('\n开始处理各路视频（仅参考图检测裁头，末尾保留）...')
                    _trimmed_a = []
                    for _r_no in sorted(_ok_a):
                        if job.stop_flag:
                            break
                        _p_a = os.path.join(job.run_dir, 'route_%d.mp4' % _r_no)
                        if os.path.exists(_p_a):
                            _tp_a = _trim_video(job, _p_a)
                            _trimmed_a.append((_r_no, _tp_a))
                    if _trimmed_a and not job.stop_flag:
                        _final_a = os.path.join(job.run_dir, '最终视频.mp4')
                        if _concat_videos(job, [q for _, q in sorted(_trimmed_a)], _final_a):
                            job.final_path = _final_a
                            job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                            _emit('\n✅ 最终视频生成: %s (%.1f MB)' % (_final_a, os.path.getsize(_final_a) / 1048576))
                            job.set_status('finished')
                            return
                    if not _trimmed_a:
                        job.set_status('failed')
                        _emit('没有任何路视频，无法合成')
                    else:
                        job.set_status('finished')
                    return
            _emit('auto16 单任务提交：%d 分镜 → 工作流内部 4901 自动统计 + floor 均分 %d 段（画布一致，服务端不切分）'
                  % (_ns_g, _N_seg))
            job.set_status('submitting')
            try:
                nid = build_node_info_list(job, (1, 1, _ns_g), seg_prompt=None)
                tid = submit(job, nid)
                _emit('已提交: %s（4001=%d 段，完整工作流执行）' % (tid, _N_seg))
                out = poll(job, tid, 1)
                dest = os.path.join(job.run_dir, 'route_1.mp4')
                got = False
                if out:
                    for k, u in enumerate(out):
                        if u.startswith(job.run_dir):
                            if os.path.exists(u) and u.endswith('.mp4'):
                                if u != dest:
                                    os.replace(u, dest)
                                got = True
                        else:
                            download(u, dest if k == 0 else os.path.join(job.run_dir, 'route_1_%d.mp4' % (k + 1)))
                            if k == 0:
                                got = os.path.exists(dest)
                elif os.path.exists(dest):
                    got = True
                if got and os.path.exists(dest) and os.path.getsize(dest) > 0:
                    _emit('完成: %s (%.1f MB)' % (dest, os.path.getsize(dest) / 1048576))
                    final = os.path.join(job.run_dir, '最终视频.mp4')
                    os.replace(dest, final)
                    job.final_path = final
                    job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                    job.set_status('finished')
                    return
                _emit('失败：无返回产物（任务失败/自杀链触发）')
                job.set_status('failed')
                return
            except Exception as e:
                _emit('异常: %s' % e)
                job.set_status('failed')
                return
        if mode == 'global' and _wfc_g.get('mode') == 'det16':
            # ===== det16 确定性切分（API 接入）：500 全局提示词 + 503 目标段数 + 并发路数 =====
            # 切分锚点防护：把 detailed_description 前置段（retention_analysis 等）的行内 [Shot N]
            # 改写为 (Shot N)，防止画布 1290-1350 全文贪婪正则被行内引用抢占锚点 → 段文本错位 → 音频污染。
            _gp_raw = cfg.get('global_prompt') or ''
            _gp_guard = _guard_shot_anchors(_gp_raw)
            if _gp_guard != _gp_raw:
                global_prompt = _gp_guard
                cfg['global_prompt'] = _gp_guard
                _emit('  ★ 切分锚点防护：detailed_description 前置段行内 [Shot N] 已改写为 (Shot N)（防画布切分正则误锚 → 音频污染）')
            # 单路（R=1）：500=完整提示词原样 + 503=N → 画布内确定性切分 N 段 + forLoop 合并（与画布执行逻辑一致）
            # 多路（R>1）：全局分镜均分 R 路，每路 500=该路子集（分镜号重排从 [Shot 1] 起），每路 503=N 段
            #           → R 路各生成 N 段长视频 → 本地拼接最终视频
            _routes_det = max(1, int(cfg.get('loop_routes') or 1))   # 并发路数：设置多少就多少，不自动提升
            # 每路段数 = ceil(总目标段数 / 路数)：16 段 ÷ 4 路 = 每路 4 段；地板 2（503=1 → forLoop total=0 → 假成功）
            _N_det = max(2, -(-int(cfg.get('target_segs') or 16) // _routes_det))
            _ns_det = count_shots(global_prompt)
            # ===== 提示词长度说明（502=false 后 LLM 已关，历史 6000 字爆窗预警已失效）=====
            _gp_len = len(global_prompt or '')
            if _gp_len > 6000:
                _emit('  全局提示词 %d 字：502=false 纯确定性切分，无 LLM 上下文限制' % _gp_len)
            if _ns_det <= 0:
                _emit('⚠ 未检测到 [Shot N] 分镜标记，确定性切分需要 [Shot 1]..[Shot N] 锚点，拒绝提交')
                job.set_status('failed')
                return
            # 每段分镜数：保证 4 段时 11 个 Shot 全部覆盖（ceil(11/4)=3，1269=3）
            _M_det = max(2, -(-int(_ns_det) // max(2, _N_det)))
            _cap_det = _M_det * _N_det
            if _ns_det > _cap_det:
                _emit('  ⚠ 提示词有 %d 个分镜，但 503=%d 段 × 1269=%d 分镜/段 只覆盖前 %d 个 → '
                      '最后 %d 个分镜不会出现；建议段数提到 %d（或减少分镜）'
                      % (_ns_det, _N_det, _M_det, _cap_det, _ns_det - _cap_det,
                         -(-_ns_det // _M_det)))
            cfg['total_segs'] = _N_det
            if _routes_det > 1:
                # 全局修复（2026-10-15）：保留每路 1/R 子集的语义，但 v10 修复画布提取链的段 4 重复污染。
                # 4 路 8 分镜/路 × 503=4 段 / 8 路 4 分镜/路 × 503=2 段 / 任意路 → 1305/1306/1351/1307 只保留有效 JjkConcat 份。
                # 旧逻辑：v9 把 1305 text3/4/5 也清空了，导致 4 段情况下 SEGMENT_3/4 的内容丢失（iter i=1/2 拿到全部 1307 重复）。
                # v10：按 503=N 段数动态计算保留范围（1305 text1..min(N,5) 保留，其余清空），任意路数 N 段都正确。
                _base_det = _ns_det // _routes_det
                _extra_det = _ns_det % _routes_det
                _plan_det = []
                _s0 = 1
                for _r in range(1, _routes_det + 1):
                    _n = _base_det + (1 if _r <= _extra_det else 0)
                    if _n <= 0:
                        continue
                    _plan_det.append((_r, _s0, _s0 + _n - 1))
                    _s0 += _n
                _per_det = _base_det + (1 if _extra_det else 0)
                _min_shots = min(b - a + 1 for _, a, b in _plan_det)
                _need = _M_det * _N_det - 1
                if _min_shots < _need:
                    _N_old = _N_det
                    _N_det = max(2, (_min_shots + 1) // 2)
                    cfg['total_segs'] = _N_det
                    if _M_det * _N_det - 1 > _min_shots:
                        # 防假成功：分镜数连 2 个非空段都凑不足（画布 1269=2，2 段需 ≥3 分镜/路）
                        # → 强制 503=1 会 forLoop total=0 假成功（无视频、自杀链不触发），直接拒绝
                        job.set_status('failed')
                        _emit('⚠ 每路最少 %d 分镜 < 2 段所需 %d 分镜（画布 1269=2）→ 拒绝提交：单段(503=1)必然假成功（无视频且自杀链不触发）'
                              % (_min_shots, _M_det * 2 - 1))
                        return
                    _emit('⚠ 每路最少 %d 分镜 < 目标 %d 段所需 %d 分镜 → 段数自动降为 %d（保证每段非空、切分正则全部命中）'
                          % (_min_shots, _N_old, _need, _N_det))
                else:
                    cfg['total_segs'] = _N_det
                _route_plans = []
                for _r, _a0, _b0 in _plan_det:
                    _sp = _seg_text_det16(global_prompt, _a0, _b0)
                    _route_plans.append((_r, _a0, _b0, _sp))
                _emit('det16 并发路数 %d（v10 全局修复版）：%d 分镜均分 %d 路 × 每路 %d 段 = 总 %d 段 → 画布内 v10 槽位按 503=%d 动态保留'
                      % (_routes_det, _ns_det, len(_route_plans), _N_det, _N_det * len(_route_plans), _N_det))
                _emit('  ★ v10 核心：仅清空 1305/1306/1351/1307 中**无效**的 JjkConcat 份（SEGMENT_(N+1) 起），保留有效 SEGMENT_1..N 份 → 提取链段 1..N 全部干净（任意 N 都正确）')
                job.set_status('submitting')
                from concurrent.futures import ThreadPoolExecutor

                def _run_route_det16(plan):
                    r_no, _a, _b, sp = plan
                    try:
                        nid = build_node_info_list(job, (r_no, _a, _b), seg_prompt=sp)
                        tid = submit(job, nid)
                        _emit('  路%d 已提交: %s（503=%d 段，完整工作流执行）' % (r_no, tid, _N_det))
                        out = poll(job, tid, r_no)
                        dest = os.path.join(job.run_dir, 'route_%d.mp4' % r_no)
                        got = False
                        if out:
                            for k, u in enumerate(out):
                                if u.startswith(job.run_dir):
                                    if os.path.exists(u) and u.endswith('.mp4'):
                                        if u != dest:
                                            os.replace(u, dest)
                                        got = True
                                else:
                                    download(u, dest if k == 0 else os.path.join(job.run_dir, 'route_%d_%d.mp4' % (r_no, k + 1)))
                                    if k == 0:
                                        got = os.path.exists(dest)
                        elif os.path.exists(dest):
                            got = True
                        if got and os.path.exists(dest) and os.path.getsize(dest) > 0:
                            _emit('  路%d 完成: %s (%.1f MB)' % (r_no, dest, os.path.getsize(dest) / 1048576))
                            return r_no, True
                        _emit('  路%d 失败：无返回产物（任务失败/自杀链触发）' % r_no)
                        return r_no, False
                    except Exception as e:
                        _emit('  路%d 异常: %s' % (r_no, e))
                        return r_no, False

                res = list(ThreadPoolExecutor(max_workers=min(_routes_det, 8)).map(_run_route_det16, _route_plans))
                ok_routes = [r for r, ok in res if ok]
                _emit('\n===== det16 各路完成 =====')
                _emit('成功路: %s' % (' '.join('路%d' % r for r in sorted(ok_routes)) if ok_routes else '无'))
                if not ok_routes:
                    job.set_status('failed')
                    _emit('没有任何路成功，无法合成')
                    return
                if len(ok_routes) == 1:
                    final = os.path.join(job.run_dir, '最终视频.mp4')
                    src = os.path.join(job.run_dir, 'route_%d.mp4' % ok_routes[0])
                    if os.path.exists(src):
                        os.replace(src, final)
                        try:
                            _sl = h3_frames(int(cfg.get('duration', 15))) / 24.0 - 48 / 24.0
                            _seams = [round(k * _sl, 4) for k in range(1, _N_det) if k * _sl > 0.8]
                            final = _normalize_audio(job, _smooth_seams(job, final, seams=_seams))
                        except Exception as _e:
                            _emit('  ⚠ 后期处理异常（保留原片）: %s' % _e)
                        job.final_path = final
                        job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                        job.set_status('finished')
                        _emit('\n✅ 最终视频生成（单路 %d 段）: %s (%.1f MB)' % (_N_det, final, os.path.getsize(final) / 1048576))
                        return
                    job.set_status('failed')
                    _emit('❌ 单路视频缺失，无法交付')
                    return
                job.set_status('trimming')
                _emit('\n开始处理各路视频（仅参考图检测裁头，末尾保留）...')
                trimmed = []
                for r_no in sorted(ok_routes):
                    if job.stop_flag:
                        break
                    p = os.path.join(job.run_dir, 'route_%d.mp4' % r_no)
                    if os.path.exists(p):
                        tp = _trim_video(job, p)
                        trimmed.append((r_no, tp))
                if trimmed and not job.stop_flag:
                    final = os.path.join(job.run_dir, '最终视频.mp4')
                    if _concat_videos(job, [q for _, q in sorted(trimmed)], final):
                        job.final_path = final
                        job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                        job.set_status('finished')
                        _emit('\n✅ 最终视频生成: %s (%.1f MB, %d 路 × %d 段)' % (final, os.path.getsize(final) / 1048576, len(trimmed), _N_det))
                        return
                if not trimmed:
                    job.set_status('failed')
                    _emit('没有任何路视频，无法合成')
                else:
                    job.set_status('failed')
                    _emit('❌ 段视频已生成但最终合成失败（详见上方 FFmpeg/合成日志）')
                return
            # 单路：500 完整提示词原样 + 503=目标段数（v11段直注，不依赖画布切分链）
            _need1 = _M_det * _N_det - 1
            if _ns_det < _need1:
                _N_old = _N_det
                # v11段直注：贪心分配，每段至少1个分镜即可，不要求 M*N-1
                _N_det = min(_N_det, _ns_det)
                cfg['total_segs'] = _N_det
                if _N_det < 2:
                    # 分镜数连2个都不够 → 只能1段，拒绝（避免假成功）
                    job.set_status('failed')
                    _emit('⚠ 全局仅 %d 个分镜，无法分成 ≥2 段（每段至少1个分镜），请提供 ≥2 个 [Shot] 分镜或多段剧情'
                          % _ns_det)
                    return
                _emit('⚠ 全局 %d 分镜 < 目标 %d 段（画布切分需 %d）→ v11段直注自动降为 %d 段（每段 %d 分镜，不依赖画布切分链）'
                      % (_ns_det, _N_old, _need1, _N_det, 1))
            ranges = [(1, 1, _ns_det)]
            # ===== 2026-10-21 音频污染全局修复（导演台+火宝双入口实锤）：单路改回 v11 段直注 =====
            # 画布原生切分链（1290-1350）用 `[\s\S]*(\[Shot N\]...)` 整段正则替换，会把 detailed_description
            # 之前的全部头部（subject_definitions/summary/retention_analysis/speaker_mapping/声景/音乐约束）
            # 吞掉 → 每段 H3 拿到"零上下文纯分镜文本" → 台词错乱/重复/音色错位/杂乱旁白（任务 1792573669225
            # 与火宝 6 任务转写实锤；旧流 2106634937741975553 整篇单段 12 句逐字全对=对照）。
            # 恢复 seg_map={1:global_prompt} → build_node_info_list 走 v11 直注（多路已验证音频干净）：
            #   199.prompt=段1 直注 + 1318/213/512 列表注入段2..N + 514.tt=222（127.prompt 逐段取列表）
            #   → 每段完整 6 段式（角色定义+summary+该段分镜+音色映射+声景+音乐约束）→ H3 上下文充足。
            # 假成功防护（503≥2 硬校验）保留在上方，画布 504=max(1,a-1) 强制循环；自杀链/合并链不动。
            seg_map = {1: global_prompt}
            n_segs = _N_det
            cfg['total_segs'] = _N_det
            _emit('det16 单路：v11 段直注（seg_prompt=完整提示词，段1→199 + 段2..N→1318 列表，绕开画布 1290-1350 切分链）')
        elif mode == 'global':
            gs = cfg.get('global_split', False)
            # 目标段数模式（target_segs>0）：把全局提示词均分成 N 段（每段 15s，合并后 N×15s）
            # 优先于 每段分镜数/切分开关；N 超过分镜数时按分镜数取（每段至少 1 个分镜）
            _tgt = int(cfg.get('target_segs') or 0)
            # 并发路数>1 且未显式设目标段数：按 分镜数/每段分镜数 自动推导（上限画布 8/16 槽，随工作流）
            if _tgt <= 0 and int(cfg.get('loop_routes') or 1) > 1:
                _spj_t = max(1, int(cfg.get('shots_per_seg') or 1))
                _ns_t = count_shots(global_prompt)
                if _ns_t > 0:
                    _tgt = max(1, min(16, -(-_ns_t // _spj_t)))
                    _emit('并发路数>1 且未设目标段数 → 自动推导 %d 段（%d 分镜 / 每段 %d 分镜）'
                          % (_tgt, _ns_t, _spj_t))
            if _tgt > 0:
                _tgt = max(1, min(32, _tgt))
                n_shots = count_shots(global_prompt)
                if (cfg.get('loop_stitch') or False) and (cfg.get('loop_prompt') or '').strip():
                    # 循环拼接 + 独立提示词：段数完全由 target_segs 决定（不依赖 global 分镜数）
                    ranges = [(k, k, k) for k in range(1, _tgt + 1)]
                    _emit('目标段数模式（循环拼接）：%d 段 × 每段 15s（独立提示词原样重复 %d 轮）' % (_tgt, _tgt))
                elif n_shots <= 0:
                    ranges = [(k, k, k) for k in range(1, _tgt + 1)]
                    _emit('目标段数模式：未检测到 [Shot N]，按 %d 段生成（每段使用完整全局提示词，段内容相同）' % _tgt)
                else:
                    if n_shots < _tgt:
                        _emit('目标段数 %d > 提示词分镜数 %d → 按 %d 段生成（每段至少 1 个分镜）'
                              % (_tgt, n_shots, n_shots))
                        _tgt = n_shots
                    base, rem = divmod(n_shots, _tgt)
                    ranges = []
                    k = 1
                    for _s in range(1, _tgt + 1):
                        cnt = base + (1 if _s <= rem else 0)
                        ranges.append((_s, k, min(k + cnt - 1, n_shots)))
                        k += cnt
                    _emit('目标段数模式：%d 个分镜均分 %d 段 → 段切分 %s（每段 15s，合并 %d 秒）'
                          % (n_shots, _tgt, ' '.join('%d-%d' % (a, b) for _, a, b in ranges), _tgt * int(cfg.get('duration', 15))))
                gs = True                       # 目标段数模式强制走 _seg_text_global_full 切分提交
                cfg['global_split'] = True
                n_segs = len(ranges)
                cfg['total_segs'] = n_segs
                # 方案A 循环拼接（loop 工作流）：一次提交，画布 forLoop 循环生成 N 段并自动尾帧衔接合并。
                # 段文本注入画布循环列表（212/508/509/510/511/210/211/6002/6003/6004），
                # 127.prompt 走循环连接（6000=249引导+222当前段），不再逐段独立提交。
                _wfc = VIDEO_WFS.get(str(cfg.get('workflow_id') or '')) or {}
                if _wfc.get('mode') in ('loop', 'slot16') or cfg.get('loop_stitch'):
                    _dur = int(cfg.get('duration', 15))
                    # 独立提示词输入区（loop_prompt）：原样提交、不做任何切分/改写；
                    # 循环 N 轮时按段数重复同一提示词（N≤画布提示词槽数），每轮仅以「上段尾帧」衔接。
                    _lp = (cfg.get('loop_prompt') or '').strip()
                    if _lp:
                        _cap = len(_wfc.get('loop_slots') or []) or 10
                        if len(ranges) > _cap:
                            _emit('⚠ 画布循环提示词槽上限 %d 段（当前 %d 段），已按 %d 段提交'
                                  % (_cap, len(ranges), _cap))
                            ranges = ranges[:_cap]
                        seg_texts = [_strip_narration(_lp)] * len(ranges)
                        _emit('循环拼接独立输入：原样提示词 %d 字 × %d 轮（不切分/不改写，仅尾帧衔接）'
                              % (len(_lp), len(ranges)))
                    else:
                        seg_texts = [_strip_narration(_seg_text_global_full(global_prompt, lo, hi, dur=_dur))
                                     for _, lo, hi in ranges]
                        _emit('循环拼接模式：%d 段文本已注入画布循环列表（一次提交，forLoop 自动尾帧衔接 + 合并输出）'
                              % len(seg_texts))
                    # 防 H3 参考图首帧锚定脑补：自动注入「强制剧情开场 + 禁止唱歌」硬约束（提示词已含则跳过）
                    _no_sing = ('\n\n【重要】开场与动作硬约束（必须严格遵守）：\n'
                                '- 视频第一帧必须直接呈现本段剧情场景画面，禁止以参考图人物单独特写、唱歌或说话作为开场\n'
                                '- 全片所有角色禁止唱歌、哼唱、随节奏摆动等表演性动作；对白仅按剧本以正常语气说出\n'
                                '- 参考图仅用于角色外观一致性锚定，不作为开场画面内容，开场即进入剧情')
                    seg_texts = [t + _no_sing if '禁止唱歌' not in t else t for t in seg_texts]
                    cfg['loop_segs'] = seg_texts
                    _routes = max(1, int(cfg.get('loop_routes') or 1))
                    # seg_500 万能切分工作流（如 2103746924129071106）为「每段 1 分镜」的 [SEGMENT_N]
                    # 标记链结构：并发多路提交时每路 500=完整提示词会从 SEGMENT_1 重复提取 → 各路段重复。
                    # 该工作流不支持并发路数切分 → 强制单任务（完整提示词循环 N 段），提示用户改选 16槽版。
                    if _wfc.get('seg_500') and _routes > 1:
                        _emit('⚠ seg_500 万能切分工作流为「每段 1 分镜」结构，不支持并发路数（会重复提取各段），'
                              '已强制单任务提交（完整提示词循环 %d 段）。如需并发路数，请改选 16段分段输入版 2109881935799959553。'
                              % len(seg_texts))
                        _routes = 1
                    if _routes > 1 and len(seg_texts) > 1:
                        # ===== 并发路数模式 =====
                        # 目标段数优先：target_segs>0 时，16/10 等目标段数严格保留 →
                        # 把「目标段数均分分镜」得到的 ranges 按并发路数分组，每路段文本 = 段内分镜子集。
                        # （不再按 shots_per_seg 重切：那样会把 16 段重算成 30 段）
                        # 未设目标段数时回退：按分镜号均分每路分镜，路内按 shots_per_seg 切段。
                        _tgt_r = int(cfg.get('target_segs') or 0)
                        _ns_total = count_shots(global_prompt) or len(seg_texts)
                        if _tgt_r > 0 and _ns_total > 0:
                            # 用目标段数的 ranges 分组（ranges 已在前面按 target_segs 均分生成）
                            # 每路段数按均分（如 16 段 / 6 路 → 3+3+3+3+2+2），保证总段数严格守恒
                            _base_r, _rem_r = divmod(len(ranges), _routes)
                            _plan = []
                            for _r in range(1, _routes + 1):
                                _n_r = _base_r + (1 if _r <= _rem_r else 0)
                                _a = sum(_base_r + (1 if _i <= _rem_r else 0) for _i in range(1, _r))
                                _b = min(_a + _n_r, len(ranges))
                                if _a >= _b:
                                    continue
                                _sub_r = ranges[_a:_b]
                                _sub = []
                                for _si, _lo, _hi in _sub_r:
                                    _t = _seg_text_global_full(global_prompt, _lo, _hi, dur=_dur)
                                    _t = _strip_narration(_t)
                                    if '禁止唱歌' not in _t:
                                        _t += _no_sing
                                    _sub.append(_t)
                                _plan.append((_r, _sub, _sub_r[0][1], _sub_r[-1][2]))
                            _ranges_plan = _plan
                            _emit('并发路数 %d：目标 %d 段均分到 %d 路（段内按目标段数切分，总段数守恒）→ 路切分: %s'
                                  % (_routes, len(ranges), len(_ranges_plan),
                                     ' '.join('路%d=Shot%d-%d(%d段)' % (r, a, b, len(s)) for r, s, a, b in _ranges_plan)))
                        else:
                            # 并发优先回退：每路 = 总分镜/路数 个分镜，路内按 shots_per_seg 切段
                            _per_shots = -(-_ns_total // _routes)
                            _lp = (cfg.get('loop_prompt') or '').strip()
                            _spj = max(1, int(cfg.get('shots_per_seg') or 2))
                            _plan = []
                            for _r in range(1, _routes + 1):
                                _a0 = (_r - 1) * _per_shots + 1
                                _b0 = min(_r * _per_shots, _ns_total)
                                if _a0 > _b0:
                                    continue
                                _sub = []
                                for _k in range(_a0, _b0 + 1, _spj):
                                    _sa = _k
                                    _sb = min(_k + _spj - 1, _b0)
                                    if _lp:
                                        _t = _lp
                                    else:
                                        _t = _seg_text_global_full(global_prompt, _sa, _sb, dur=_dur)
                                        _t = _strip_narration(_t)
                                        if '禁止唱歌' not in _t:
                                            _t += _no_sing
                                    _sub.append(_t)
                                _plan.append((_r, _sub, _a0, _b0))
                            _ranges_plan = _plan
                            _emit('并发路数 %d：%d 分镜分 %d 路（每路 %d 分镜，每段 %d 分镜）→ 路切分: %s'
                                  % (_routes, _ns_total, len(_ranges_plan), _per_shots, _spj,
                                     ' '.join('路%d=Shot%d-%d(%d段)' % (r, a, b, len(s)) for r, s, a, b in _ranges_plan)))
                        job.set_status('submitting')
                        from concurrent.futures import ThreadPoolExecutor

                        def _run_route(plan):
                            r_no, sub, _a, _b = plan
                            try:
                                nid = build_node_info_list(job, (r_no, 0, 0), loop_segs=sub)
                                tid = submit(job, nid)
                                _emit('  路%d 已提交: %s（内部循环 %d 轮）' % (r_no, tid, len(sub)))
                                out = poll(job, tid, r_no)
                                dest = os.path.join(job.run_dir, 'route_%d.mp4' % r_no)
                                got = False
                                if out:
                                    for k, u in enumerate(out):
                                        if u.startswith(job.run_dir):
                                            if os.path.exists(u) and u.endswith('.mp4'):
                                                if u != dest:
                                                    os.replace(u, dest)
                                                got = True
                                        else:
                                            download(u, dest if k == 0 else os.path.join(job.run_dir, 'route_%d_%d.mp4' % (r_no, k + 1)))
                                            if k == 0:
                                                got = os.path.exists(dest)
                                elif os.path.exists(dest):
                                    got = True
                                if got and os.path.exists(dest) and os.path.getsize(dest) > 0:
                                    _emit('  路%d 完成: %s (%.1f MB)' % (r_no, dest, os.path.getsize(dest) / 1048576))
                                    return r_no, True
                                _emit('  路%d 失败：无返回产物（任务失败/自杀链触发）' % r_no)
                                return r_no, False
                            except Exception as e:
                                _emit('  路%d 异常: %s' % (r_no, e))
                                return r_no, False

                        res = list(ThreadPoolExecutor(max_workers=_routes).map(_run_route, _ranges_plan))
                        ok_routes = [r for r, ok in res if ok]
                        _emit('\n===== 各路完成 =====')
                        _emit('成功路: %s' % (' '.join('路%d' % r for r in sorted(ok_routes)) if ok_routes else '无'))
                        if not ok_routes:
                            job.set_status('failed')
                            _emit('没有任何路成功，无法合成')
                            return
                        job.set_status('trimming')
                        _emit('\n开始处理各路视频（仅参考图检测裁头，末尾保留）...')
                        trimmed = []
                        for r_no in sorted(ok_routes):
                            if job.stop_flag:
                                break
                            p = os.path.join(job.run_dir, 'route_%d.mp4' % r_no)
                            if os.path.exists(p):
                                tp = _trim_video(job, p)
                                trimmed.append((r_no, tp))
                        if trimmed and not job.stop_flag:
                            final = os.path.join(job.run_dir, '最终视频.mp4')
                            if _concat_videos(job, [q for _, q in sorted(trimmed)], final):
                                job.final_path = final
                                job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                                _emit('\n✅ 最终视频生成: %s (%.1f MB)'
                                      % (final, os.path.getsize(final) / 1048576))
                                job.set_status('finished')
                                return
                        if not trimmed:
                            job.set_status('failed')
                            _emit('没有任何路视频，无法合成')
                        else:
                            job.set_status('finished')
                        return
                    ranges = [(1, 0, 0)]        # 整个循环作为一个任务提交
                    seg_map = {}
                    n_segs = 1
            elif not gs:
                prompt0 = (global_prompt or '').strip()
                ranges = [(1, 1, 1)]
                seg_map = {1: prompt0}
                n_segs = 1
                cfg['total_segs'] = 1
                _emit('全局提示词切分开关：关闭 → 完整提示词原样单段提交（不切分，忽略每段分镜数设置）')
            else:
                n_shots = count_shots(global_prompt)
                spj = int(cfg.get('shots_per_seg') or 1)
                if spj < 1:
                    spj = 1
                if n_shots <= 0:
                    n_segs = int(cfg.get('total_segs') or 32)
                    ranges = [(k, k, k) for k in range(1, n_segs + 1)]
                    _emit('全局模式：未检测到 [Shot N]，按 %d 段均分' % n_segs)
                elif n_shots <= spj:
                    # 分镜数 ≤ 每段分镜数 → 一段一个分镜
                    ranges = [(k, k, k) for k in range(1, n_shots + 1)]
                    _emit('全局模式：检测到 %d 个 [Shot N]，每段分镜数设置 %d（≥分镜数）→ 每段 1 个分镜，共 %d 段'
                          % (n_shots, spj, n_shots))
                else:
                    # 按 spj 个分镜一组（前 N 组各 spj 个，末组余数）
                    ranges = []
                    k = 1
                    while k <= n_shots:
                        end = min(k + spj - 1, n_shots)
                        ranges.append((len(ranges) + 1, k, end))
                        k = end + 1
                    _emit('全局模式：检测到 %d 个 [Shot N]，每段 %d 个分镜 → %d 段（切分: %s）'
                          % (n_shots, spj, len(ranges), ' '.join('%d-%d' % (a, b) for _, a, b in ranges)))
                n_segs = len(ranges)
                cfg['total_segs'] = n_segs
        else:
            filled = [(i + 1, t.strip()) for i, t in enumerate(seg_prompts) if t and t.strip()]
            _wfc_m = VIDEO_WFS.get(str(cfg.get('workflow_id') or '')) or {}
            if _wfc_m.get('mode') in ('loop', 'slot16'):
                # slot16 / loop 工作流（如 2109548545899601921 8段版 / 2109881935799959553 16段版）：
                # 手动分段提示词 = 段文本直填 N 槽 → forLoop 一次提交循环拼接（不走全局提示词/自动切分）
                if not filled:
                    _emit('没有非空分段提示词，任务取消')
                    job.set_status('failed')
                    return
                seg_texts = [t for _, t in filled]
                # 防 H3 参考图首帧锚定脑补：自动注入「强制剧情开场 + 禁止唱歌」硬约束（提示词已含则跳过）
                _no_sing_m = ('\n\n【重要】开场与动作硬约束（必须严格遵守）：\n'
                              '- 视频第一帧必须直接呈现本段剧情场景画面，禁止以参考图人物单独特写、唱歌或说话作为开场\n'
                              '- 全片所有角色禁止唱歌、哼唱、随节奏摆动等表演性动作；对白仅按剧本以正常语气说出\n'
                              '- 参考图仅用于角色外观一致性锚定，不作为开场画面内容，开场即进入剧情')
                seg_texts = [t + _no_sing_m if '禁止唱歌' not in t else t for t in seg_texts]
                _cap_m = len(_wfc_m.get('prompt_slots') or _wfc_m.get('loop_slots') or []) or 10
                if len(seg_texts) > _cap_m:
                    _emit('⚠ 画布提示词槽上限 %d 段（当前 %d 段），已按 %d 段提交（其余忽略）'
                          % (_cap_m, len(seg_texts), _cap_m))
                    seg_texts = seg_texts[:_cap_m]
                cfg['loop_segs'] = seg_texts
                cfg['total_segs'] = len(seg_texts)
                _routes_m = max(1, int(cfg.get('loop_routes') or 1))
                if _routes_m > 1 and len(seg_texts) > 1:
                    # ===== 手动分段 + 并发路数：N 段均分到 R 路（如 10 段 / 3 路 = 3-3-4），
                    #      每路独立提交（内部循环该路段数），R 路全部完成后本地合并 =====
                    _base_r, _rem_r = divmod(len(seg_texts), _routes_m)
                    _plan_m = []
                    for _r in range(1, _routes_m + 1):
                        _n_r = _base_r + (1 if _r > _routes_m - _rem_r else 0)
                        _a = sum(_base_r + (1 if _i > _routes_m - _rem_r else 0) for _i in range(1, _r))
                        _b = min(_a + _n_r, len(seg_texts))
                        if _a >= _b:
                            continue
                        _plan_m.append((_r, seg_texts[_a:_b], _a + 1, _b))
                    _emit('手动分段并发路数 %d：%d 段均分到 %d 路（3-3-4 式）→ 路切分: %s'
                          % (_routes_m, len(seg_texts), len(_plan_m),
                             ' '.join('路%d=段%d-%d(%d段)' % (r, a, b, len(s)) for r, s, a, b in _plan_m)))
                    job.set_status('submitting')
                    from concurrent.futures import ThreadPoolExecutor

                    def _run_route_m(plan):
                        r_no, sub, _a, _b = plan
                        try:
                            nid = build_node_info_list(job, (r_no, 0, 0), loop_segs=sub)
                            tid = submit(job, nid)
                            _emit('  路%d 已提交: %s（内部循环 %d 轮）' % (r_no, tid, len(sub)))
                            out = poll(job, tid, r_no)
                            dest = os.path.join(job.run_dir, 'route_%d.mp4' % r_no)
                            got = False
                            if out:
                                for k, u in enumerate(out):
                                    if u.startswith(job.run_dir):
                                        if os.path.exists(u) and u.endswith('.mp4'):
                                            if u != dest:
                                                os.replace(u, dest)
                                            got = True
                                    else:
                                        download(u, dest if k == 0 else os.path.join(job.run_dir, 'route_%d_%d.mp4' % (r_no, k + 1)))
                                        if k == 0:
                                            got = os.path.exists(dest)
                            elif os.path.exists(dest):
                                got = True
                            if got and os.path.exists(dest) and os.path.getsize(dest) > 0:
                                _emit('  路%d 完成: %s (%.1f MB)' % (r_no, dest, os.path.getsize(dest) / 1048576))
                                return r_no, True
                            _emit('  路%d 失败：无返回产物（任务失败/自杀链触发）' % r_no)
                            return r_no, False
                        except Exception as e:
                            _emit('  路%d 异常: %s' % (r_no, e))
                            return r_no, False

                    res_m = list(ThreadPoolExecutor(max_workers=_routes_m).map(_run_route_m, _plan_m))
                    ok_routes_m = [r for r, ok in res_m if ok]
                    _emit('\n===== 各路完成 =====')
                    _emit('成功路: %s' % (' '.join('路%d' % r for r in sorted(ok_routes_m)) if ok_routes_m else '无'))
                    if not ok_routes_m:
                        job.set_status('failed')
                        _emit('没有任何路成功，无法合成')
                        return
                    job.set_status('trimming')
                    _emit('\n开始处理各路视频（仅参考图检测裁头，末尾保留）...')
                    trimmed_m = []
                    for r_no in sorted(ok_routes_m):
                        if job.stop_flag:
                            break
                        p = os.path.join(job.run_dir, 'route_%d.mp4' % r_no)
                        if os.path.exists(p):
                            tp = _trim_video(job, p)
                            trimmed_m.append((r_no, tp))
                    if trimmed_m and not job.stop_flag:
                        final_m = os.path.join(job.run_dir, '最终视频.mp4')
                        if _concat_videos(job, [q for _, q in sorted(trimmed_m)], final_m):
                            job.final_path = final_m
                            job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                            _emit('\n✅ 最终视频生成: %s (%.1f MB, %d 路)'
                                  % (final_m, os.path.getsize(final_m) / 1048576, len(trimmed_m)))
                            job.set_status('finished')
                            return
                    if not trimmed_m:
                        job.set_status('failed')
                        _emit('没有任何路视频，无法合成')
                    else:
                        job.set_status('finished')
                    return
                ranges = [(1, 0, 0)]
                seg_map = {}
                n_segs = 1
                _emit('手动分段 + 循环拼接：%d 段提示词已注入画布循环列表（一次提交，forLoop 自动尾帧衔接 + 合并输出）'
                      % len(seg_texts))
            else:
                ranges = [(s, s, s) for s, _ in filled]
                seg_map = dict(filled)
                _emit('手动分段模式：%d 段有提示词（空提示词段自动跳过）' % len(filled))
                if not ranges:
                    _emit('没有非空分段提示词，任务取消')
                    job.set_status('failed')
                    return
        # 并发数 = 提交段数上限（0=无限制=全部段；N>0=仅提交前 N 段，测试用）
        cfg_concurrency = cfg.get('concurrency') or 0
        if cfg_concurrency > 0 and cfg_concurrency < len(ranges):
            _emit('并发数 = %d：仅提交前 %d 段（测试模式，其余 %d 段本次跳过）'
                  % (cfg_concurrency, cfg_concurrency, len(ranges) - cfg_concurrency))
            ranges = ranges[:cfg_concurrency]
        concurrency = cfg_concurrency or len(ranges)
        _emit('并发数: %d（提交间隔 %.1fs）' % (concurrency, cfg.get('submit_gap', 0.5)))
        # 阶段 1：提交全部
        job.set_status('submitting')
        submitted = []
        for r in ranges:
            if job.stop_flag:
                job.set_status('stopped')
                _emit('任务已停止（提交阶段）')
                return
            seg = r[0]
            sp = seg_map.get(seg, '') if (mode == 'manual' or not cfg.get('global_split')) else None
            job.segments[seg] = {'status': 'submitting', 'task_id': None, 'file': None,
                                 'url': None, 'error': None, 'shot_lo': r[1], 'shot_hi': r[2]}
            _emit('提交 段%d%s' % (seg, ('（手动提示词 %d 字）' % len(sp)) if sp else ''))
            nid = build_node_info_list(job, r, seg_prompt=sp)
            tid = submit(job, nid)
            _emit('  id: %s' % tid)
            job.segments[seg]['task_id'] = tid
            submitted.append((r, tid))
            time.sleep(cfg.get('submit_gap', 0.5))
        # 阶段 2：并发轮询
        job.set_status('running')
        from concurrent.futures import ThreadPoolExecutor

        def _poll_one(arg):
            r, tid = arg
            seg = r[0]
            job.segments[seg]['status'] = 'running'
            _emit('\n等待 段%d (%s)' % (seg, tid))
            out = poll(job, tid, seg)
            dest = os.path.join(job.run_dir, 'seg_%d.mp4' % seg)
            ok = False
            picked = None
            if out:
                for k, u in enumerate(out):
                    if u.startswith(job.run_dir):
                        if os.path.exists(u):
                            ok = True
                            picked = u
                    else:
                        download(u, os.path.join(job.run_dir, 'seg_%d_%d.mp4' % (seg, k + 1)))
                if os.path.exists(dest):
                    ok = True
                    picked = dest
                else:
                    cs = sorted(_g.glob(os.path.join(job.run_dir, 'seg_%d_*.mp4' % seg)))
                    if cs:
                        ok = True
                        picked = cs[0]
            elif os.path.exists(dest):
                ok = True
                picked = dest
                _emit('  ★ poll 无接口产物但文件已存在（WS 已下载）→ 段%d 计成功' % seg)
            if ok:
                job.segments[seg]['status'] = 'success'
                job.segments[seg]['file'] = picked
            else:
                job.segments[seg]['status'] = 'failed'
                job.segments[seg]['error'] = '无返回产物（任务失败/自杀链触发）'
            return seg, ok
        results = list(ThreadPoolExecutor(max_workers=concurrency).map(_poll_one, submitted))
        ok_segs = [s for s, ok in results if ok]
        miss = [s for s, ok in results if not ok]
        _emit('\n===== 全部完成 =====')
        _emit('已获取分段: %s' % (' '.join(str(s) for s in sorted(ok_segs)) if ok_segs else '无'))
        if miss:
            _emit('失败段: %s' % ' '.join(str(s) for s in miss))
        # 阶段 3：裁剪（仅参考图检测裁头，末尾保留）+ 合成
        job.set_status('trimming')
        _emit('\n开始裁剪每段（仅参考图检测裁头，视频末尾不裁剪）...')
        trimmed = []
        for s in sorted(ok_segs):
            if job.stop_flag:
                break
            p = os.path.join(job.run_dir, 'seg_%d.mp4' % s)
            if not os.path.exists(p):
                cs = sorted(_g.glob(os.path.join(job.run_dir, 'seg_%d_*.mp4' % s)))
                if cs:
                    p = cs[0]
            if os.path.exists(p):
                _emit('\n开始处理 段%d...' % s)
                tp = _trim_video(job, p)
                job.segments[s]['file'] = tp
                trimmed.append((s, tp))
        if trimmed and not job.stop_flag:
            final = os.path.join(job.run_dir, '最终视频.mp4')
            if _concat_videos(job, [q for _, q in sorted(trimmed)], final):
                job.final_path = final
                job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                _emit('\n✅ 最终视频生成: %s (%.1f MB)'
                      % (final, os.path.getsize(final) / 1048576))
                job.set_status('finished')
                return
        if not trimmed:
            job.set_status('failed')
            _emit('没有任何分段产物，无法合成')
        else:
            job.set_status('finished')
            _emit('已停止，保留已生成分段（未合成最终视频）')
    except Exception as e:
        import traceback
        _emit('任务异常: %s' % e)
        _emit(traceback.format_exc()[-1500:])
        job.set_status('failed')
    finally:
        _tls.job = None

# ---------- 单段手动重跑 ----------
# ===== 图片生成（Qwen-Image-2.1）=====
IMG_WF_CACHE = {}
IMG_TASKS = {}
IMG_FOUND = {}    # 图片任务 task_id -> [urls]（WS 通道抓到）
IMG_DONE = {}      # 图片任务 task_id -> True（WS 监听已结束/全部收集完成）
IMG_FOUND_WAIT = {}  # 图片任务 task_id -> 已缓冲轮询次数（多图收尾兜底）
IMG_LOGS = {}     # 图片任务 task_id -> [日志行]
IMG_WAIT = {}     # 图片任务 805 失败等待计数（自杀链预期，等 WS 缓冲）
WEB_ROOT = BASE   # 与 IMAGES_DIR/VIDEOS_DIR 对齐（backend/rh_h3_web）
IMG_DIRS = {}     # 图片任务 task_id -> 本地产物目录（web/image/年月日+8位随机）
IMG_SHOT = {}     # 图片任务 task_id -> 镜头前缀（批量脚本：镜头1/镜头2…，文件名前缀用）
# ===== 音频（VoxCPM2 配音）=====
AUDIO_DIRS = {}   # 音频任务 task_id -> 产物目录（web/audio/年月日+8位随机）
AUDIO_FOUND = {}  # 音频任务 task_id -> [urls]（WS 通道抓到）
AUDIO_DONE = {}   # 音频任务 task_id -> True
AUDIO_WAIT = {}   # 音频任务 task_id -> 等待计数
AUDIO_LOGS = {}   # 音频任务 task_id -> [logs]
AUDIO_TASKS = {}  # 音频任务 task_id -> {cfg}
AUDIO_MERGED = {} # 批次目录 -> 合并后文件相对路径（web/ 根）
NEUTRAL_IMG = os.path.join(REFS_DIR, '_neutral.png')   # 文生图时注入 109/122 的中性图（中和参考图节点）
_NEUTRAL_FN = {}   # api_key -> 中性图平台 fileName（复用，避免重复上传）

# ===== RunningHub Model API 兼容层（供 huobao-drama 等第三方项目调用；免扣费） =====
# 第三方按 RunningHub Model API 形态调用（POST /openapi/v2/{model} + POST /openapi/v2/query），
# 本层把请求桥接为工作台内部 Workflow API（/task/openapi/create + 自杀链），实现免扣费。
RH_OPENAPI = {}
RH_OPENAPI_LIVE = {}          # taskId -> {'kind':'image'|'video','api_key','task_id','job_id'}
RH_IMAGE_MODELS = ('qwen2.1', 'qwen-image-2.1', 'flux-dev', 'sdxl', 'qwen-image', 'qwen2.5')
RH_VIDEO_MODELS = ('minimaxh3', 'cogvideox', 'animatediff', 'seedance', 'minimax')
RH_IMG_WFID = '2104862502025711618'  # 老工作流（文生图+图生图合一；横屏画布默认16:9 Widescreen不注入，easy sleep链805免扣费+WS拿图）

# ===== 图片工作流注册表（前端下拉自由切换） =====
IMG_WF_REGISTRY = {
    RH_IMG_WFID: {
        'name': 'Qwen-Image-2.1（文生图+图生图）', 'key': 'qwen-image-2.1',
        'prompt_classes': ['TextEncodeQwenImage21'], 'switch_class': 'ComfySwitchNode',
        'has_ref': True,
    },
    '2101119999196127233': {
        'name': 'Krea2 最强N版（文生图）', 'key': 'krea2',
        'prompt_classes': ['CLIPTextEncode'], 'switch_class': None,
        'has_ref': False,
    },
    '2112778471972896770': {
        'name': 'Krea2-muse 角色参考写真（图生图）', 'key': 'krea2-muse',
        'prompt_classes': [], 'prompt_node': '169',   # Text Multiline.text（widget 直通主提示词）
        'switch_class': None,
        'has_ref': True, 'ref_count': 3,              # 参考图 3 张（104/296/297，按用户锚定顺序：图1→104、图2→296、图3→297）
        'ref_slots': {'104': 0, '296': 1, '297': 2},  # 用户重新锚定：每张图只注入一个节点，不再同图双节点
        'ratio_nodes': {'172': 16, '173': 9},         # INTConstant value：16:9 横屏默认（截图1位置）
        'batch_nodes': ['269'],                       # easy int value → RepeatLatentBatch.amount
        'batch_size_node': '183',                     # EmptyImage.batch_size
        'prompt_clean': {'291': 'prompt'},            # 清 291 CR Prompt Text 固定残留提示词
    },
}

# 比例映射：'16:9 (Widescreen)' → (16,9)
def _ratio_pair(ratio_str):
    _r = (ratio_str or '')
    for _k in ('16:9', '9:16', '1:1', '4:3', '3:4', '21:9'):
        if _r.startswith(_k):
            return tuple(int(x) for x in _k.split(':'))
    return None

def _img_workflows_json():
    out = []
    for _k, _v in IMG_WF_REGISTRY.items():
        out.append({'wfid': _k, 'name': _v['name'], 'key': _v['key'],
                    't2i_only': not _v.get('has_ref', True),
                    'prompt_classes': _v.get('prompt_classes', [])})
    return out
RH_VIDEO_WFID = '2106729712572071938'   # 视频工作流（32路·动漫文戏二采，自杀式免扣分）
RH_BASE_URL = 'http://127.0.0.1:8765'

# ===== 内存状态持久化（重启不丢） =====
# 第三方（如 huobao-drama 火宝）持久化 taskId 到 sys_task.taskId 后，依赖 /openapi/v2/query
# 拿到本地产物 URL 显示图片。如果 8765 重启，内存字典 RH_OPENAPI/IMG_DIRS 清零，已落盘
# 的 web/image/<dir>/ 还在但 taskId 查不到 → FAILED unknown taskId → 第三方孤儿任务卡死。
# 这里把图片类任务的 taskId→产物目录 落盘到 rh_state.json，启动时读回来重建字典：
#   - IMG_DIRS[tid]：决定 img_poll 命中本地目录后即时返回 finished + URL
#   - RH_OPENAPI[tid]（image 类）：决定 /openapi/v2/query 路由到 image 分支
# 不持久化 JOBS/WS_FOUND/IMG_FOUND（视频 cfg 含不可序列化对象；WS/Found 仅缓存，重启用本地目录重扫）。
STATE_FILE = os.path.join(WEB_ROOT, 'rh_state.json')
_state_lock = threading.Lock()

# 默认模型锁定：导演台内部可自由切换测试；外部 API（/openapi/v2/*）调用时强制走锁定的工作流。
# kind: 'image' | 'video'，值为工作流 id 或 None（未锁定）。持久化到 rh_state.json。
MODEL_LOCK = {'image': None, 'video': None}

# 参数锁定：外部 API 调用（其他应用/火宝等）提交时，若开启则强制跟随导演台当前参数（覆盖调用方传入值）。
# video: {'locked': bool, 'resolution': float, 'aspect_ratio': str}
PARAM_LOCK = {
    'video': {'locked': False, 'resolution': 0.4, 'aspect_ratio': 'match'},
    'image': {'locked': False, 'resolution': 2.0},
}

def _load_state():
    if not os.path.exists(STATE_FILE):
        return
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            s = json.loads(f.read() or '{}')
    except Exception as e:
        print('[state] 读 rh_state.json 失败: %s（忽略）' % e)
        return
    n_dir = n_api = 0
    for tid, d in (s.get('img_dirs') or {}).items():
        abs_dir = d if os.path.isabs(d) else os.path.join(WEB_ROOT, d)
        if os.path.isdir(abs_dir):
            IMG_DIRS[tid] = abs_dir
            n_dir += 1
    for tid, ent in (s.get('rh_openapi') or {}).items():
        # 只恢复图片类（视频类 JOBS 含 cfg/thread 不可序列化，跳过）
        if isinstance(ent, dict) and ent.get('kind') == 'image':
            RH_OPENAPI[tid] = ent
            n_api += 1
    _lk = s.get('model_lock') or {}
    if isinstance(_lk, dict):
        for _k in ('image', 'video'):
            if _lk.get(_k):
                MODEL_LOCK[_k] = str(_lk[_k])
    _pl = s.get('param_lock') or {}
    if isinstance(_pl, dict):
        for _k in ('image', 'video'):
            _ent = _pl.get(_k)
            if isinstance(_ent, dict) and _k in PARAM_LOCK:
                PARAM_LOCK[_k].update({kk: vv for kk, vv in _ent.items() if kk in PARAM_LOCK[_k]})
    print('[state] 状态恢复完成：IMG_DIRS=%d, RH_OPENAPI(image)=%d, MODEL_LOCK=%s, PARAM_LOCK=%s（来源：%s）'
          % (n_dir, n_api, MODEL_LOCK, PARAM_LOCK, STATE_FILE))

def _save_state():
    """落盘 IMG_DIRS + RH_OPENAPI(image) + MODEL_LOCK 到 rh_state.json。原子写入（tmp + replace）。"""
    with _state_lock:
        try:
            data = {
                'img_dirs': {
                    tid: (d if os.path.isabs(d) else os.path.relpath(d, WEB_ROOT))
                    for tid, d in IMG_DIRS.items()
                },
                'rh_openapi': {
                    tid: ent for tid, ent in RH_OPENAPI.items()
                    if isinstance(ent, dict) and ent.get('kind') == 'image'
                },
                'model_lock': dict(MODEL_LOCK),
                'param_lock': {k: dict(v) for k, v in PARAM_LOCK.items()},
                'updated_at': time.time(),
            }
            tmp = STATE_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                f.write(json.dumps(data, ensure_ascii=False))
            os.replace(tmp, STATE_FILE)
        except Exception as e:
            print('[state] 写 rh_state.json 失败: %s' % e)

# 启动时立即恢复（do_POST 接到请求前 RH_OPENAPI/IMG_DIRS 必须就绪）
_load_state()

def _rh_map_ratio(size):
    s = (size or '').strip().lower()
    if '1:1' in s or 'square' in s or s in ('1024x1024', '768x768'):
        return '1:1 (Square)'
    if '16:9' in s or 'landscape' in s or s in ('1344x768', '1280x720', '1920x1080'):
        return '16:9 (Widescreen)'   # 画布枚举格式；注入 '16:9 (Landscape Widescreen)' 触发平台预检假成功
    return '9:16 (Portrait Widescreen)'

def _rh_abs(u):
    if not u:
        return u
    if u.startswith('http://') or u.startswith('https://'):
        return u
    return RH_BASE_URL + ('' if u.startswith('/') else '/') + u

def _rh_dl_ref(url):
    """下载第三方传入的参考图（firstFrameUrl 等）到 refs 目录，返回本地路径；失败返回 None。

    2026-10-22 同步 nsfwxo 加固：RunningHub 上传 CDN 偶发 TLS 断连（EOF/UNEXPECTED_EOF），
    单次 urllib 失败会让参考图静默丢失 → 工作流沿用画布旧图。改为 3 级降级：
      ① 带 UA 直下 ② 复用 download()（URL 编码、无 UA） ③ 关闭证书校验。
    """
    url = (url or '').strip()
    if not url or not (url.startswith('http://') or url.startswith('https://')):
        return None
    fp = os.path.join(REFS_DIR, 'rh_api_ref_%d.png' % int(time.time() * 1000))
    errs = []
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=60).read()
        if len(data) >= 500:
            with open(fp, 'wb') as f:
                f.write(data)
            return fp
        errs.append('短响应')
    except Exception as e:
        errs.append(str(e))
    try:
        tmp = fp + '.part'
        download(url, tmp)
        if os.path.exists(tmp) and os.path.getsize(tmp) >= 500:
            os.replace(tmp, fp)
            _emit('  [开放API] 参考图已通过降级通道下载: %s' % os.path.basename(fp))
            return fp
        if os.path.exists(tmp):
            os.remove(tmp)
        errs.append('降级下载为空')
    except Exception as e:
        errs.append(str(e))
    try:
        import ssl as _ssl
        ctx = _ssl._create_unverified_context()
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=60, context=ctx).read()
        if len(data) >= 500:
            with open(fp, 'wb') as f:
                f.write(data)
            _emit('  [开放API] 参考图已通过免校验通道下载: %s' % os.path.basename(fp))
            return fp
        errs.append('免校验响应过短')
    except Exception as e:
        errs.append(str(e))
    _emit('[开放API] 参考图下载失败（3 级重试全部失败）: %s | %s'
          % (url[:100], ' ; '.join(errs)[:300]))
    return None

def _img_find(wf, cls=None, nid=None):
    """在平台 API JSON（dict key=节点id字符串）中按 class_type 或 id 找节点。"""
    if nid is not None and str(nid) in wf:
        return str(nid), wf[str(nid)]
    for k, v in wf.items():
        if cls and v.get('class_type') == cls:
            return k, v
    return None, None

def _img_upload(api_key, path):
    """上传图片参考图到平台，返回 fileName。"""
    _fk = types.SimpleNamespace(cfg={'api_key': api_key})
    return upload_file(_fk, path)

def _ensure_neutral():
    """首次运行生成 512x512 浅灰中性 PNG（纯 Python，无 PIL 依赖）。"""
    if os.path.exists(NEUTRAL_IMG):
        return NEUTRAL_IMG
    try:
        import zlib, struct
        W = H = 512
        def _chunk(t, d):
            c = t + d
            return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c))
        ihdr = struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)
        row = b'\x00' + b'\xf0\xf0\xf0' * W
        png = b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', ihdr) + _chunk(b'IDAT', zlib.compress(row * H)) + _chunk(b'IEND', b'')
        with open(NEUTRAL_IMG, 'wb') as f:
            f.write(png)
        _emit('[图片] 已生成中性图 %s (%d B)' % (NEUTRAL_IMG, len(png)))
    except Exception as e:
        _emit('[图片] 中性图生成失败: %s' % e)
    return NEUTRAL_IMG if os.path.exists(NEUTRAL_IMG) else None

def _neutral_fn(api_key):
    """取中性图的平台 fileName（缓存复用）。"""
    if api_key not in _NEUTRAL_FN:
        _ensure_neutral()
        _NEUTRAL_FN[api_key] = _img_upload(api_key, NEUTRAL_IMG)
        _em_now = '[图片] 中性图已上传（文生图中和参考图节点）'
        _emit(_em_now)
    return _NEUTRAL_FN[api_key]

def img_submit(cfg):
    """提交图片生成任务（Qwen-Image-2.1 工作流）。
    cfg: workflow_id / api_key / instance / prompt / mode(t2i|i2i) /
          optimize(bool) / ratio / megapixels / batch / refs[]"""
    api_key, wid = cfg['api_key'], cfg['workflow_id']
    _reg = IMG_WF_REGISTRY.get(str(wid)) or IMG_WF_REGISTRY[RH_IMG_WFID]
    _logs = []
    def _em(m):
        _logs.append(m)
        _emit('[图片] ' + m)
    wf = IMG_WF_CACHE.get(wid)
    if not wf:
        conn = _conn()
        conn.request('POST', '/api/openapi/getJsonApiFormat',
                     json.dumps({'apiKey': api_key, 'workflowId': wid}),
                     {'Host': HOST, 'Content-Type': 'application/json'})
        j = json.loads(conn.getresponse().read().decode())
        if j.get('code') != 0 or not j.get('data', {}).get('prompt'):
            raise RuntimeError('拉取图片工作流失败: ' + json.dumps(j)[:200])
        wf = json.loads(j['data']['prompt']) if isinstance(j['data']['prompt'], str) else j['data']['prompt']
        IMG_WF_CACHE[wid] = wf
        _em('已拉取图片工作流 %s（%d 节点）' % (wid, len(wf)))
    L = []
    def push(nid, f, v):
        L.append({'nodeId': str(nid), 'fieldName': f, 'fieldValue': v})
    # 0) 提示词：纯 Text 节点优先（老工作流 123.text，widget 直通编码器，避免被 123:0 链接覆盖）
    _text_injected = False
    for _kt, _ndt in wf.items():
        if _ndt.get('class_type') == 'Text' and 'text' in _ndt.get('inputs', {}):
            push(_kt, 'text', cfg.get('prompt', ''))
            _em('注入 Text(%s).text %d 字（widget 直通，绕过链接覆盖）' % (_kt, len(cfg.get('prompt', ''))))
            _text_injected = True
            break
    # 1) 提示词：注册的 prompt_node（按 id）优先；否则按 prompt_classes（1618=TextEncodeQwenImage21 / Krea2=CLIPTextEncode）
    k, nd = None, None
    if _reg.get('prompt_node'):
        k, nd = _img_find(wf, nid=_reg['prompt_node'])
    if nd is None:
        for _pc in _reg.get('prompt_classes', ['TextEncodeQwenImage21']):
            k, nd = _img_find(wf, _pc)
            if nd is not None:
                break
    if nd is None:
        raise RuntimeError('未找到提示词节点(%s)' % ','.join(_reg.get('prompt_classes', ['TextEncodeQwenImage21'])))
    inp = nd.get('inputs', {})
    tf = None
    for cand in ('text', 'prompt'):
        if cand in inp:
            tf = cand; break
    if tf is None:
        for f, v in inp.items():
            if isinstance(v, str) and len(v) < 5000:
                tf = f; break
    if tf:
        push(k, tf, cfg.get('prompt', ''))
        _em('注入提示词(%s) %d 字' % (tf, len(cfg.get('prompt', ''))))
    for _c_nid, _c_field in (_reg.get('prompt_clean') or {}).items():
        _cn = wf.get(_c_nid)
        if _cn and _c_field in _cn.get('inputs', {}):
            push(_c_nid, _c_field, '')
            _em('清残留提示词 %s.%s = ""（工作流默认固定提示词已清除，防止覆盖用户提示词）' % (_c_nid, _c_field))
    # JjkText 兜底：部分工作流 TextEncode.prompt 被上游开关节点链接覆盖（widget 不生效），
    # JjkText 是纯静态文本入口，注入它保证提示词真正到达编码器
    for _kj, _ndj in wf.items():
        if _ndj.get('class_type') == 'JjkText' and 'text' in _ndj.get('inputs', {}):
            push(_kj, 'text', cfg.get('prompt', ''))
            _em('注入 JjkText(%s).text %d 字（绕过上游开关覆盖）' % (_kj, len(cfg.get('prompt', ''))))
            break
    # 2) 提示词自动优化开关：QwenPERewriteT8 无独立布尔开关，transparent_rgba 是透明背景参数，
    #    注入它会触发 121 失败（image references），故不再注入任何 QwenPE 布尔字段。
    #    优化是否参与生成由画布连接决定（4.prompt 接 123 原文=不生效；接 121 rewritten_prompt=生效）。
    _em('提示词优化开关: %s（QwenPE 重写由画布连接决定，不影响任务稳定性）' % ('开启' if cfg.get('optimize') else '关闭'))
    # 3) 文生图/图生图开关（按注册 switch_class；Krea2 纯文生图无开关）
    mode = cfg.get('mode', 't2i')
    k3, nd3 = _img_find(wf, _reg['switch_class']) if _reg.get('switch_class') else (None, None)
    if nd3 is not None and 'switch' in nd3.get('inputs', {}):
        # 注意：本工作流 switch=true -> EmptySD3LatentImage（文生图）；switch=false -> TextEncode.latent（图生图，含参考图）
        push(k3, 'switch', mode == 't2i')
        _em('模式: %s (switch=%s)' % ('文生图' if mode == 't2i' else '图生图', mode == 't2i'))
    # 4) 参考图（LoadImage 节点）
    #    文生图：不注入（工作流默认占位图，如 Krea2-muse 296/297/104 已固化白底占位）
    #    图生图：用户上传多少张就注入多少张，空槽位保留工作流默认占位图（不补中性图/不复制）
    refs = [r for r in (cfg.get('refs') or []) if r]
    if not _reg.get('has_ref', True):
        _em('该工作流无参考图节点（纯文生图），跳过参考图注入')
        refs = []
    elif mode == 't2i':
        refs = []   # 文生图不注入参考图节点：工作流默认已固化为白底占位图
        _em('文生图模式：不注入参考图（工作流默认占位图）')
    elif not refs:
        _em('图生图模式但未上传参考图：全部槽位保留工作流默认占位图')
    _slots = _reg.get('ref_slots') or {}
    if _slots:
        # API 文件接入映射：{LoadImage节点id: refs索引}，同一索引可复用上传结果
        # （Krea2-muse 实证：296 与 104 同填图1，104 是 grounding 主图+patch source）
        _up_cache = {}
        for _sn, _ri in sorted(_slots.items(), key=lambda x: x[1]):
            if _ri < 0 or _ri >= len(refs) or not refs[_ri]:
                continue
            _p = refs[_ri]
            if _ri not in _up_cache:
                if _p.startswith('api/') or _p.startswith('http'):
                    _up_cache[_ri] = _p
                else:
                    _up_cache[_ri] = _img_upload(api_key, _p) if os.path.exists(_p) else _p
            push(_sn, 'image', _up_cache[_ri])
            _em('参考图%d -> 节点%s（注入值 %s）' % (_ri + 1, _sn, str(_up_cache[_ri])[:60]))
    else:
        # 兜底：按 LoadImage 遍历顺序注入前 N 张（其他工作流保持原行为）
        lk = 0
        for k4, nd4 in wf.items():
            if not _reg.get('has_ref', True):
                break
            if nd4.get('class_type') == 'LoadImage' and lk < len(refs):
                p = refs[lk]
                if p.startswith('api/') or p.startswith('http'):
                    up = p
                else:
                    up = _img_upload(api_key, p) if os.path.exists(p) else p
                push(k4, 'image', up)
                _em('参考图%d -> %s（注入值 %s）' % (lk + 1, os.path.basename(p), (str(up)[:60] if up else 'None')))
                lk += 1
    # 文生图：不注入 QwenPERewriteT8(121)（task 保持 auto，image 走工作流连接）。
    # 4.5) 比例（ratio_nodes 工作流：INTConstant value，如 Krea2-muse 172/173=16:9 横屏）
    _rp = _ratio_pair(cfg.get('ratio', ''))
    if _reg.get('ratio_nodes') and _rp:
        for _rn, _rv in _reg['ratio_nodes'].items():
            _val = _rp[0] if str(_rn) == next(iter(_reg['ratio_nodes'])) else _rp[1]
            push(_rn, 'value', _val)
        _em('比例: %s:%s（INTConstant 注入，横屏默认16:9）' % (_rp[0], _rp[1]))
    # 5) 比例/像素（ResolutionSelector）
    k5, nd5 = _img_find(wf, 'ResolutionSelector')
    if nd5 is not None:
        inp5 = nd5.get('inputs', {})
        if 'aspect_ratio' in inp5:
            _ar_v = cfg.get('ratio', '9:16 (Portrait Widescreen)')
            if _ar_v.startswith('16:9'):
                # 实测：注入 '16:9 (Landscape Widescreen)' 触发平台预检假成功(code=0扣费无图)；
                # 但注入画布枚举 '16:9 (Widescreen)' 不触发预检（已实测 805 正常），
                # 且画布默认可能被改（如 9:16），故横屏也显式注入枚举值保证比例正确
                push(k5, 'aspect_ratio', '16:9 (Widescreen)')
                _em('比例: 16:9 (Widescreen)（画布枚举注入，避免画布默认9:16 & 平台预检）')
            else:
                push(k5, 'aspect_ratio', _ar_v)
                _em('比例: %s' % _ar_v)
        if 'megapixels' in inp5:
            push(k5, 'megapixels', float(cfg.get('megapixels', 2)))
            _em('像素: %.1fM' % float(cfg.get('megapixels', 2)))
    # 5.5) 生成张数（batch_nodes：easy int value → RepeatLatentBatch.amount；batch_size_node：EmptyImage.batch_size）
    if _reg.get('batch_nodes') or _reg.get('batch_size_node'):
        _bn = int(cfg.get('batch', 1))
        for _bnid in (_reg.get('batch_nodes') or []):
            push(_bnid, 'value', _bn)
        if _reg.get('batch_size_node'):
            push(_reg['batch_size_node'], 'batch_size', _bn)
        _em('生成张数: %d（batch_nodes/batch_size_node 注入）' % _bn)
    # 6) 生成张数（EmptySD3LatentImage.batch_size）
    k6, nd6 = _img_find(wf, 'EmptySD3LatentImage')
    if nd6 is None:
        k6, nd6 = _img_find(wf, 'EmptyLatentImage')
    if nd6 is not None and 'batch_size' in nd6.get('inputs', {}):
        push(k6, 'batch_size', int(cfg.get('batch', 1)))
        _em('生成张数: %d' % int(cfg.get('batch', 1)))
    # 6.5) 图生图比例：TextEncodeQwenImage21.resolution 枚举注入（0=默认/1=9:16 等，按需校准）
    if mode == 'i2i' and cfg.get('res4') is not None:
        for _k4, _nd4 in wf.items():
            if _nd4.get('class_type') == 'TextEncodeQwenImage21' and 'resolution' in _nd4.get('inputs', {}):
                push(_k4, 'resolution', int(cfg['res4']))
                _em('图生图 resolution=%d（比例档位）' % int(cfg['res4']))
    # 7) 自杀链：平台可运行版已内建（SaveImage → easy sleep → PurgeVRAM → 自杀SaveImage 类型错误报错）
    #    检测到内建自杀链（easy sleep 节点存在）则不动主 SaveImage（保证正常出图+免扣分）；
    #    非平台版（无内建链）则注入 filename_prefix 超长（保存失败免扣分，备用）
    # 自杀链识别：a) easy sleep 内建链；b) 自杀 SaveImage 的 images 输入直接连接主 SaveImage 输出
    #            （主图后必报错版：119 -> 150，150 等主图完成后收到文件名 str → AttributeError → 免扣费+有图）
    has_suicide_chain = any(nd.get('class_type') == 'easy sleep' for nd in wf.values())
    if not has_suicide_chain:
        for _k9, _nd9 in wf.items():
            if _nd9.get('class_type') in ('SaveImage', 'ComfyMathExpression'):
                for _f9, _v9 in (_nd9.get('inputs') or {}).items():
                    if isinstance(_v9, list) and str(_v9[0]) in wf:
                        _up9 = wf.get(str(_v9[0]), {})
                        if _up9.get('class_type') == 'SaveImage':
                            has_suicide_chain = True
                        elif _up9.get('class_type') not in ('SaveImage',):
                            # 两跳：上游（如 PurgeVRAM/easy sleep 等透传节点）的输入追溯到主 SaveImage
                            for _f9b, _v9b in (_up9.get('inputs') or {}).items():
                                if isinstance(_v9b, list) and str(_v9b[0]) in wf and wf.get(str(_v9b[0]), {}).get('class_type') == 'SaveImage':
                                    has_suicide_chain = True
                                    break
                    if has_suicide_chain:
                        _em('自杀链已内建（主图后必报错：SaveImage→%s→SaveImage），主 SaveImage 正常出图' % _up9.get('class_type'))
                        break
            if has_suicide_chain:
                break
    found_save = False
    for k7, nd7 in wf.items():
        if nd7.get('class_type') == 'SaveImage':
            found_save = True
            if has_suicide_chain:
                # 用户手动验证形态：只给自杀 SaveImage（filename_prefix != 主前缀 ComfyUI）注入超长路径，
                # 主 SaveImage 正常出图；119 完成后自杀 SaveImage 必保存失败报错 → 免扣费 + 拿图
                _pref7 = None
                for _f7, _v7 in (nd7.get('inputs') or {}).items():
                    if _f7 == 'filename_prefix' and not isinstance(_v7, list):
                        _pref7 = _v7
                if _pref7 != 'ComfyUI':
                    # 自杀 SaveImage(497) 直连主图 487:1(images IMAGE)，必等主图保存完成后执行；
                    # 注入非法外部路径 ../x*4000 → SaveImage 保存失败报错(805免扣费)，横竖屏均触发，无 easy sleep 时序竞争
                    push(k7, 'filename_prefix', '../' + 'x' * 4000)
                    _em('自杀链注入：%s.filename_prefix = ../x*4000（直连主图487:1 images，外部路径必报错免扣费）' % k7)
            else:
                _em('无内建自杀链：注入 %s 超长文件名（兜底）' % k7)
                push(k7, 'filename_prefix', 'x' * 4000)
    if not found_save:
        raise RuntimeError('未找到 SaveImage 节点（自杀链无法注入）')
    if has_suicide_chain:
        _em('自杀链已内建（easy sleep → PurgeVRAM → 自杀SaveImage），主 SaveImage 正常出图')
    else:
        _em('自杀链注入：SaveImage.filename_prefix = ../x*4000（免扣费，备用）')
    # 8) Delay / easy sleep 节点（若有）注入延迟 30s
    for k8, nd8 in wf.items():
        inp8 = nd8.get('inputs', {})
        ct = nd8.get('class_type', '')
        if 'delay' in inp8 and ct not in ('SaveImage',) and ('Delay' in ct or 'sleep' in ct.lower()):
            push(k8, 'delay', IMG_SUICIDE_DELAY)
            _em('自杀链注入：%s.delay = %d（图片专用，>主图生成耗时保证自杀链在主图后触发）' % (k8, IMG_SUICIDE_DELAY))
    payload = json.dumps({'apiKey': api_key, 'workflowId': wid, 'nodeInfoList': L,
                          'instanceType': cfg.get('instance', 'plus')})
    for attempt in range(1, 6):
        try:
            conn = _conn()
            conn.request('POST', '/task/openapi/create', payload,
                         {'Host': HOST, 'Content-Type': 'application/json'})
            j = json.loads(conn.getresponse().read().decode())
            if j.get('code') == 0 and j.get('data', {}).get('taskId'):
                tid = j['data']['taskId']
                nw = (j.get('data') or {}).get('netWssUrl') or ''
                bt = (cfg.get('batch_tag') or '').strip()
                if bt:
                    _d = os.path.join(IMAGES_DIR, bt)
                else:
                    _d = os.path.join(IMAGES_DIR, time.strftime('%Y%m%d') + ''.join(_rnd.choices('0123456789', k=8)))
                os.makedirs(_d, exist_ok=True)
                IMG_DIRS[tid] = _d
                IMG_SHOT[tid] = (cfg.get('shot_tag') or '').strip()
                _em('已提交图片任务 id: %s' % tid)
                _em('图片产物目录: web/image/%s/' % os.path.basename(_d))
                # 提交即启动 WS 抓主图（响应自带 netWssUrl，不再依赖 outputs 轮询 804，
                # 避免并发/限流下 WS 启动失败导致图片拿不到）
                if nw:
                    WS_SEG[tid] = None
                    start_ws(types.SimpleNamespace(cfg={'api_key': api_key}), tid, nw, None)
                    _em('已启动 WS 监听 %s（提交即连）...' % tid[-6:])
                else:
                    # 平台响应偶发缺 netWssUrl：启动 outputs 轮询兜底（804 阶段补获 WS / 直取直链）
                    threading.Thread(target=_img_ws_patch,
                                     args=(types.SimpleNamespace(cfg={'api_key': api_key}), tid),
                                     daemon=True).start()
                    _em('提交响应缺 netWssUrl，已启动 outputs 轮询兜底（804 阶段补获 WS 或直取直链）...')
                return tid, _logs, nw
            raise RuntimeError('提交失败: ' + json.dumps(j)[:300])
        except Exception as e:
            _em('提交异常(%s)，%d 秒后重试 (第%d/5次)...' % (e, 2 * attempt, attempt))
            time.sleep(2 * attempt)
    raise RuntimeError('图片任务提交失败（重试5次仍失败）')

def _img_ws_patch(job, task_id):
    """提交响应缺 netWssUrl 的兜底：轮询 outputs 补获 WS（804 执行中阶段 data 带 netWssUrl）
    或直接取 fileUrl 落盘。图片任务自杀链 delay=60s，轮询窗口 150s 覆盖主图生成。"""
    deadline = time.time() + 150
    while time.time() < deadline:
        try:
            conn = _conn()
            conn.request('POST', '/task/openapi/outputs',
                         json.dumps({'apiKey': job.cfg['api_key'], 'taskId': task_id}),
                         {'Host': HOST, 'Content-Type': 'application/json'})
            j = json.loads(conn.getresponse().read().decode())
        except Exception:
            time.sleep(3)
            continue
        c = j.get('code')
        if c == 0 and j.get('data'):
            urls = [o.get('fileUrl') for o in j['data'] if o.get('fileUrl')]
            if urls:
                _img_download(urls, task_id)
                with WS_LOCK:
                    IMG_DONE[task_id] = True
                _emit('[图片] 补获 outputs 图片直链 %d 张（无 netWssUrl 兜底）' % len(urls))
                return
        elif c in (804, 805):
            nw = (j.get('data') or {}).get('netWssUrl')
            if nw and task_id not in WS_LISTENERS:
                WS_SEG[task_id] = None
                start_ws(job, task_id, nw, None)
                _emit('[图片] 轮询补获 netWssUrl，已启动 WS 监听 %s...' % task_id[-6:])
                return
        time.sleep(3)
    _emit('[图片] 无 netWssUrl 兜底超时（150s），任务 %s 主图可能需人工查平台' % task_id[-6:])

def _img_download(urls, task_id):
    """把生成的图片下载保存到 web/image/年月日+8位随机数/。
    返回 (remote_urls, local_urls, local_thumbs)；local_urls 为 web/ 根下的相对路径（供下载），
    local_thumbs 为缩略图（宽320 JPEG，供前端列表显示，防止 CDN 大图直链导致浏览器内存过高）。"""
    out, local, th = [], [], []
    _d = IMG_DIRS.get(task_id)
    if not _d:
        # 恢复的/异常任务没有登记目录时现场创建（web/image/年月日+8位随机数）
        _d = os.path.join(WEB_ROOT, 'image', time.strftime('%Y%m%d') + str(_rnd.randint(10000000, 99999999)))
        try:
            os.makedirs(_d, exist_ok=True)
            IMG_DIRS[task_id] = _d
            _save_state()   # 持久化：8765 重启后恢复该 taskId 的本地产物路径
            _emit('[图片] 自动创建产物目录: %s' % _d)
        except Exception as e:
            _emit('[图片] 创建目录失败 %s: %s' % (_d, e))
            _d = None
    seen = set()
    for u in (urls or []):
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
        lp = None
        if _d:
            try:
                fn = os.path.basename(u.split('?')[0]) or ('img_%d.png' % len(out))
                shot = IMG_SHOT.get(task_id)
                if shot:
                    fn = shot + '_' + fn
                fp = os.path.join(_d, fn)
                if not os.path.exists(fp):
                    req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
                    body = b''
                    last_err = None
                    for _attempt in range(3):
                        try:
                            with urllib.request.urlopen(req, timeout=120) as _r:
                                body = _r.read()
                            if len(body) > 1000:
                                break
                        except Exception as _e:
                            last_err = _e
                            # IncompleteRead 会带已下载的 partial 数据，够大就直接用
                            _partial = getattr(_e, 'partial', b'') or b''
                            if len(_partial) > 1000:
                                body = _partial
                                break
                            time.sleep(1.5)
                    if len(body) > 1000:
                        with open(fp, 'wb') as f:
                            f.write(body)
                        _emit('[图片] 已保存: %s (%d KB)' % (fp, len(body) // 1024))
                if os.path.exists(fp):
                    rel = os.path.relpath(fp, WEB_ROOT)
                    lp = '/' + rel.replace(os.sep, '/')
                    # 缩略图（宽320 JPEG），列表显示用，避免 CDN 原图直链撑爆浏览器内存
                    thf = os.path.splitext(fp)[0] + '_thumb.jpg'
                    if not os.path.exists(thf):
                        try:
                            subprocess.run(['sips','-Z','320','-s','format','jpeg','-s','formatOptions','80',
                                            fp,'--out',thf], capture_output=True, timeout=30, check=True)
                        except Exception as e:
                            _emit('[图片] 缩略图失败 %s: %s' % (fp, e))
                    if os.path.exists(thf):
                        relt = os.path.relpath(thf, WEB_ROOT)
                        th.append('/' + relt.replace(os.sep, '/'))
                    else:
                        th.append(lp or u)
            except Exception as e:
                _emit('[图片] 保存失败 %s: %s' % (u[:80], e))
        local.append(lp or u)
    return out, local, th

def img_poll(task_id, api_key):
    """查询图片任务输出（与视频同逻辑：WS 通道优先抓图，自杀链 805 失败不立即判定）。
    返回 (status, urls, err, logs)。"""
    logs = IMG_LOGS.get(task_id, [])
    if task_id in IMG_FOUND or task_id in IMG_DIRS:
        # 本地目录优先：WS 一旦落盘立即返回本地 URL（不依赖 IMG_DONE/CDN 重下，
        # 杜绝 WS 落盘后 query 仍长时间 running 导致火宝超时）
        _d0 = IMG_DIRS.get(task_id)
        if _d0 and os.path.isdir(_d0):
            _f0 = sorted(f for f in os.listdir(_d0)
                         if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and '_thumb.' not in f)
            if _f0:
                _lus = ['/' + os.path.relpath(os.path.join(_d0, f), WEB_ROOT).replace(os.sep, '/') for f in _f0]
                _ths = [os.path.splitext(u)[0] + '_thumb.jpg' for u in _lus]
                return 'finished', list(_lus), list(_lus), _ths, logs
        # WS 仍在收图（batch>1 多图）时先不结束，等 execution_success/监听结束再 finished；
        # IMG_FOUND_WAIT >=3（约24s）兜底：即使未收到 success/error 也结束
        if task_id in IMG_FOUND and not IMG_DONE.get(task_id) and IMG_FOUND_WAIT.get(task_id, 0) < 3:
            IMG_FOUND_WAIT[task_id] = IMG_FOUND_WAIT.get(task_id, 0) + 1
            return 'running', None, None, None, logs
        urls, local_urls, th = _img_download(IMG_FOUND.get(task_id) or [], task_id)
        # 预登记目录但图片尚未落盘（WS 抓图/下载中）：返回 running 等待，
        # 避免 watch 提前结束、query 拿到空目录返回空结果
        if not any((u or '').startswith('/') for u in (local_urls or [])):
            return 'running', None, None, None, logs
        return 'finished', urls, local_urls, th, logs
    try:
        conn = _conn()
        conn.request('POST', '/task/openapi/outputs',
                     json.dumps({'apiKey': api_key, 'taskId': task_id}),
                     {'Host': HOST, 'Content-Type': 'application/json',
                      'Authorization': 'Bearer ' + api_key})
        j = json.loads(conn.getresponse().read().decode())
    except Exception:
        return 'running', None, None, None, logs
    if j.get('code') == 0 and j.get('data'):
        urls, local_urls, th = _img_download([o.get('fileUrl') for o in j['data'] if o.get('fileUrl')], task_id)
        return 'finished', urls, local_urls, th, logs
    if j.get('code') in (804, 805):
        d = j.get('data') or {}
        nw = d.get('netWssUrl')
        if nw and task_id not in WS_LISTENERS:
            WS_SEG[task_id] = None
            start_ws(types.SimpleNamespace(cfg={'api_key': api_key}), task_id, nw, None)
            _emit('[图片] 已启动 WS 监听 %s...' % task_id[-6:])
        if j.get('code') == 805:
            IMG_WAIT[task_id] = IMG_WAIT.get(task_id, 0) + 1
            _emit('[图片] 任务失败(自杀链预期)等待 WS 图片缓冲 第 %d 次...' % IMG_WAIT[task_id])
            if IMG_WAIT[task_id] > 30:
                return 'failed', None, None, json.dumps(d)[:300], logs
            return 'running', None, None, None, logs
        return 'running', None, None, None, logs
    return 'running', None, None, None, logs

def img_watch(task_id, api_key):
    """图片提交后主动后台轮询（5s 间隔）：命中 804 启动 WS 抓主图，任务 805 自杀链后图片已缓冲；上限 ~20min。"""
    task_id = str(task_id)
    for _ in range(240):
        try:
            st, urls, local, th, logs = img_poll(task_id, api_key)
            if st in ('finished', 'failed'):
                _emit('[图片] watch 结束 task=%s status=%s' % (task_id[-6:], st))
                return
        except Exception:
            pass
        time.sleep(5)

# ================= 音频（VoxCPM2 配音） =================
AUDIO_WF_CACHE = {}
def _audio_find_text(wf, nid):
    """找 CR Prompt Text 节点（按画布节点 id，如 15/16），返回 (api_key, input字段)。"""
    if str(nid) in wf:
        nd = wf[str(nid)]
        inp = nd.get('inputs', {}) or {}
        for f in ('text', 'prompt', 'widget'):
            if f in inp:
                return str(nid), f
        for f, v in inp.items():
            if isinstance(v, str):
                return str(nid), f
    return None, None

def audio_submit(cfg):
    """提交 VoxCPM2 配音任务（单段）。
    cfg: workflow_id / api_key / instance / text(口播文案 node16) /
         prompt(提示词 node15 默认"广东话") / voice(参考音色本地路径或 api/...) /
         seg_label(段标签, 如 段1/段3) / batch_tag(批次目录名)"""
    _logs = []
    _em = lambda s: _logs.append(s)
    wid = str(cfg.get('workflow_id', '')).strip()
    api_key = (cfg.get('api_key') or '').strip()
    if not wid or not api_key:
        raise RuntimeError('缺少 workflow_id 或 api_key')
    if not (cfg.get('text') or '').strip():
        raise RuntimeError('口播文案为空')
    _em('===== [音频] 提交段 %s =====' % (cfg.get('seg_label') or ''))
    # 拉工作流（缓存）
    wf = AUDIO_WF_CACHE.get(wid)
    if wf is None:
        _wf_err = None
        for _at in range(1, 4):
            try:
                conn = _conn()
                conn.request('POST', '/api/openapi/getJsonApiFormat',
                             json.dumps({'apiKey': api_key, 'workflowId': int(wid)}),
                             {'Host': HOST, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key})
                j = json.loads(conn.getresponse().read().decode())
                _d = j.get('data') or {}
                if not _d.get('prompt'):
                    _wf_err = RuntimeError('平台返回异常: %s' % json.dumps(j)[:200])
                    time.sleep(2 * _at)
                    continue
                wf = json.loads(_d['prompt']) if isinstance(_d['prompt'], str) else _d['prompt']
                AUDIO_WF_CACHE[wid] = wf
                _em('已从平台拉取音频工作流 %s 的 API JSON（%d 节点）' % (wid, len(wf)))
                break
            except Exception as e:
                _wf_err = RuntimeError('拉取音频工作流失败: %s' % e)
                if _at < 3:
                    time.sleep(2 * _at)
        if wf is None:
            raise _wf_err
    def push(nid, f, v):
        wf.setdefault(str(nid), {})['inputs'][f] = v
    # 1) 口播文案 node16
    k16, f16 = _audio_find_text(wf, 16)
    if k16:
        push(k16, f16, cfg['text'])
        _em('注入口播文案 node16（%d 字）' % len(cfg['text']))
    else:
        _em('⚠ 未找到文案节点 16（CR Prompt Text）')
    # 2) 参考音色 node13（LoadAudio）
    voice = (cfg.get('voice') or '').strip()
    if voice:
        if voice.startswith('api/') or voice.startswith('http'):
            upv = voice
        elif os.path.exists(voice):
            upv = upload_file(types.SimpleNamespace(cfg={'api_key': api_key}), voice)
            _em('上传参考音色 -> %s' % os.path.basename(voice))
        else:
            upv = voice
        if str(13) in wf:
            inp13 = wf[str(13)].get('inputs', {}) or {}
            f13 = None
            for cand in ('audio', 'image', 'file'):
                if cand in inp13:
                    f13 = cand; break
            if not f13:
                for f, v in inp13.items():
                    if isinstance(v, str):
                        f13 = f; break
            if f13:
                push(13, f13, upv)
                _em('注入参考音色 node13.%s -> %s' % (f13, os.path.basename(upv.split('/')[-1])))
            else:
                _em('⚠ 未找到 LoadAudio(13) 输入字段')
    else:
        _em('未提供参考音色，使用工作流默认音色')
    # 3) 提示词 node15（默认 广东话）
    k15, f15 = _audio_find_text(wf, 15)
    if k15:
        push(k15, f15, (cfg.get('prompt') or '广东话').strip())
        _em('注入提示词 node15: %s' % (cfg.get('prompt') or '广东话'))
    # 4) 自杀链：工作流已内建（easy sleep -> PurgeVRAM -> 自杀 SaveImage），保留不注入
    _em('自杀链已内建（easy sleep → PurgeVRAM → 自杀SaveImage），保留')
    # 提交
    node_info = []
    for nid, nd in wf.items():
        inp = nd.get('inputs', {}) or {}
        for f, v in inp.items():
            if f == 'image' and isinstance(v, str) and (v.startswith('api/') or v.startswith('http')):
                node_info.append({'fieldName': f, 'nodeId': nid, 'fieldValue': v})
            elif f in ('text', 'audio', 'prompt') and isinstance(v, str):
                node_info.append({'fieldName': f, 'nodeId': nid, 'fieldValue': v})
    _d = os.path.join(WEB_ROOT, 'audio', cfg.get('batch_tag') or (time.strftime('%Y%m%d') + str(_rnd.randint(10000000, 99999999))))
    try:
        os.makedirs(_d, exist_ok=True)
    except Exception:
        pass
    for attempt in range(1, 6):
        try:
            conn = _conn()
            # 与视频/图片一致的 openapi 提交方式（/task/openapi/create，无需 Bearer）
            body = json.dumps({'apiKey': api_key, 'workflowId': int(wid), 'nodeInfoList': node_info,
                               'instanceType': cfg.get('instance') or 'plus'})
            conn.request('POST', '/task/openapi/create', body,
                         {'Host': HOST, 'Content-Type': 'application/json'})
            j = json.loads(conn.getresponse().read().decode())
            tid = str(j.get('data', {}).get('taskId') or j.get('data', {}).get('task_id') or '')
            if tid:
                AUDIO_DIRS[tid] = _d
                AUDIO_TASKS[tid] = cfg
                AUDIO_LOGS[tid] = _logs
                _em('已提交音频任务 id: %s' % tid)
                _em('音频产物目录: web/audio/%s/' % os.path.basename(_d))
                return tid, _logs
            if str(j.get('code')) in ('412', '401'):
                # Token 失效：立即失败，不重试拖时间
                _em('提交被拒绝(%s)：API Key 无效或已失效，请到 RunningHub 平台重新生成 API Key' % j.get('code'))
                raise RuntimeError('API Key 无效或已失效（code %s），请重新生成 API Key 后重试' % j.get('code'))
            raise RuntimeError('提交失败: ' + json.dumps(j)[:300])
        except Exception as e:
            if 'API Key 无效' in str(e) or '412' in str(e):
                raise
            _em('提交异常(%s)，%d 秒后重试 (第%d/5次)...' % (e, 2 * attempt, attempt))
            time.sleep(2 * attempt)
    raise RuntimeError('音频任务提交失败（重试5次仍失败）')

def _audio_download(urls, task_id):
    """把生成的音频下载保存到 web/audio/年月日+8位随机/。返回 (remote_urls, local_urls)。"""
    out, local = [], []
    _d = AUDIO_DIRS.get(task_id)
    if not _d:
        _d = os.path.join(WEB_ROOT, 'audio', time.strftime('%Y%m%d') + str(_rnd.randint(10000000, 99999999)))
        try:
            os.makedirs(_d, exist_ok=True)
            AUDIO_DIRS[task_id] = _d
            _emit('[音频] 自动创建产物目录: %s' % _d)
        except Exception:
            _d = None
    seen = set()
    for u in (urls or []):
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
        lp = None
        if _d:
            try:
                fn = os.path.basename(u.split('?')[0]) or ('audio_%d.flac' % len(out))
                seg_label = AUDIO_TASKS.get(task_id, {}).get('seg_label') or ''
                if seg_label:
                    fn = seg_label + '_' + fn
                fp = os.path.join(_d, fn)
                if not os.path.exists(fp):
                    req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
                    body = urllib.request.urlopen(req, timeout=120).read()
                    if len(body) > 1000:
                        with open(fp, 'wb') as f:
                            f.write(body)
                        _emit('[音频] 已保存: %s (%d KB)' % (fp, len(body) // 1024))
                if os.path.exists(fp):
                    rel = os.path.relpath(fp, WEB_ROOT)
                    lp = '/' + rel.replace(os.sep, '/')
            except Exception as e:
                _emit('[音频] 保存失败 %s: %s' % (u[:80], e))
        local.append(lp or u)
    return out, local

def audio_poll(task_id, api_key):
    """查询音频任务输出（WS 通道优先抓音频，自杀链 805 失败不立即判定）。返回 (status, urls, local, err, logs)。"""
    logs = AUDIO_LOGS.get(task_id, [])
    if task_id in AUDIO_FOUND:
        if not AUDIO_DONE.get(task_id) and AUDIO_WAIT.get(task_id, 0) < 3:
            AUDIO_WAIT[task_id] = AUDIO_WAIT.get(task_id, 0) + 1
            return 'running', None, None, None, None, logs
        urls, local_urls = _audio_download(AUDIO_FOUND[task_id], task_id)
        return 'finished', urls, local_urls, None, logs
    try:
        conn = _conn()
        conn.request('POST', '/task/openapi/outputs',
                     json.dumps({'apiKey': api_key, 'taskId': task_id}),
                     {'Host': HOST, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key})
        j = json.loads(conn.getresponse().read().decode())
    except Exception:
        return 'running', None, None, None, None, logs
    if j.get('code') == 0 and j.get('data'):
        urls, local_urls = _audio_download([o.get('fileUrl') for o in j['data'] if o.get('fileUrl')], task_id)
        return 'finished', urls, local_urls, None, logs
    if j.get('code') in (804, 805):
        d = j.get('data') or {}
        nw = d.get('netWssUrl')
        if nw and task_id not in WS_LISTENERS:
            WS_SEG[task_id] = None
            start_ws(types.SimpleNamespace(cfg={'api_key': api_key}), task_id, nw, None)
            _emit('[音频] 已启动 WS 监听 %s...' % task_id[-6:])
        if j.get('code') == 805:
            AUDIO_WAIT[task_id] = AUDIO_WAIT.get(task_id, 0) + 1
            _emit('[音频] 任务失败(自杀链预期)等待 WS 音频缓冲 第 %d 次...' % AUDIO_WAIT[task_id])
            if AUDIO_WAIT[task_id] > 30:
                return 'failed', None, None, json.dumps(d)[:300], logs
            return 'running', None, None, None, None, logs
        return 'running', None, None, None, None, logs
    return 'running', None, None, None, None, logs

def audio_merge(files, out_dir):
    """按顺序合并多段音频（ffmpeg concat filter）。files 为本地绝对路径列表。返回合并后相对路径。"""
    if not files:
        raise RuntimeError('无可合并的音频文件')
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception:
        pass
    out = os.path.join(out_dir, '最终音频.wav')
    args = ['ffmpeg', '-y']
    for f in files:
        args += ['-i', f]
    args += ['-filter_complex', ''.join('[%d:a]aformat=sample_rates=44100:channel_layouts=stereo[a%d];' % (i, i) for i in range(len(files))) +
             ''.join('[a%d]' % i for i in range(len(files))) + 'concat=n=%d:v=0:a=1[aout]' % len(files),
             '-map', '[aout]', '-c:a', 'pcm_s16le', out]
    r = subprocess.run(args, capture_output=True, timeout=300)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError('ffmpeg 合并失败: ' + (r.stderr.decode('utf-8', 'ignore')[-200:]))
    _emit('[音频] 已合并 %d 段 -> %s (%d KB)' % (len(files), out, os.path.getsize(out) // 1024))
    rel = os.path.relpath(out, WEB_ROOT)
    return '/' + rel.replace(os.sep, '/')

def rerun_seg(job, seg, prompt):
    _tls.job = job
    try:
        prompt = (prompt or '').strip()
        if not prompt:
            _emit('⚠ 段%d 提示词为空，拒绝重跑' % seg)
            return
        _emit('\n===== 手动重跑 段%d =====' % seg)
        _emit('  提示词: %s…' % prompt[:80].replace('\n', ' '))
        _old = job.segments.get(seg, {})
        job.segments[seg] = {'status': 'submitting', 'task_id': None, 'file': None,
                             'url': None, 'error': None, 'prompt': prompt,
                             'shot_lo': _old.get('shot_lo', seg), 'shot_hi': _old.get('shot_hi', seg)}
        nid = build_node_info_list(job, (seg, job.segments[seg]['shot_lo'], job.segments[seg]['shot_hi']), seg_prompt=prompt)
        tid = submit(job, nid)
        _emit('  id: %s' % tid)
        job.segments[seg]['task_id'] = tid
        job.set_status('running')
        _emit('\n等待 段%d (%s)' % (seg, tid))
        out = poll(job, tid, seg)
        dest = os.path.join(job.run_dir, 'seg_%d.mp4' % seg)
        ok = False
        picked = None
        if out:
            for k, u in enumerate(out):
                if u.startswith(job.run_dir):
                    if os.path.exists(u):
                        ok = True
                        picked = u
                else:
                    download(u, os.path.join(job.run_dir, 'seg_%d_%d.mp4' % (seg, k + 1)))
            if os.path.exists(dest):
                ok = True
                picked = dest
            else:
                cs = sorted(_g.glob(os.path.join(job.run_dir, 'seg_%d_*.mp4' % seg)))
                if cs:
                    ok = True
                    picked = cs[0]
        elif os.path.exists(dest):
            ok = True
            picked = dest
            _emit('  ★ poll 无接口产物但文件已存在（WS 已下载）→ 段%d 计成功' % seg)
        if not ok:
            job.segments[seg]['status'] = 'failed'
            job.segments[seg]['error'] = '重跑无产物'
            _emit('  段%d 重跑失败（无产物）' % seg)
            return
        job.segments[seg]['status'] = 'success'
        job.segments[seg]['file'] = picked
        tp = _trim_video(job, picked)
        job.segments[seg]['file'] = tp
        _emit('  段%d 重跑成功并裁剪: %s' % (seg, os.path.basename(tp)))
        # 重新合成最终视频（该任务所有成功段）
        trimmed = []
        for sk, v in sorted(job.segments.items(), key=lambda x: int(x[0])):
            if v.get('status') == 'success' and v.get('file') and os.path.exists(v['file']):
                trimmed.append((int(sk), v['file']))
        if trimmed:
            final = os.path.join(job.run_dir, '最终视频.mp4')
            if _concat_videos(job, [q for _, q in trimmed], final):
                job.final_path = final
                job.final_url = '/media/%s/最终视频.mp4' % os.path.basename(job.run_dir)
                _emit('✅ 最终视频已重新合成: %s (%.1f MB, %d 段)'
                      % (final, os.path.getsize(final) / 1048576, len(trimmed)))
                job.set_status('finished')
    except Exception as e:
        import traceback
        _emit('重跑段%d 异常: %s' % (seg, e))
        _emit(traceback.format_exc()[-1200:])
        if seg in job.segments:
            job.segments[seg]['status'] = 'failed'
            job.segments[seg]['error'] = str(e)[:120]
    finally:
        _tls.job = None

# ================= HTTP 服务 =================
def _recent_video_history(limit=8):
    """扫描产物目录，返回最近含『最终视频.mp4』的历史完成视频快照（服务重启后 /api/jobs 仍能展示）。"""
    out = []
    try:
        if not os.path.isdir(VIDEOS_DIR):
            return out
        hits = []
        for d in os.listdir(VIDEOS_DIR):
            fp = os.path.join(VIDEOS_DIR, d)
            v = os.path.join(fp, '最终视频.mp4')
            if os.path.isdir(fp) and os.path.exists(v):
                hits.append((os.path.getmtime(v), d))
        hits.sort(reverse=True)
        for _, d in hits[:limit]:
            out.append({
                'id': d, 'status': 'finished',
                'cfg': {'mode': 'global'},
                'segments': {},
                'final_url': '/media/%s/最终视频.mp4' % d,
                'final_name': '最终视频.mp4', 'log_len': 0,
            })
    except Exception:
        pass
    return out


def _dir_history_list(base, exts, media_prefix, limit=50):
    """通用产物目录历史扫描：名字=本地文件夹名（与 web/videos|web/image 一一对应）。
    返回按修改时间倒序的 {name, count, items:[url...], first_url, mtime} 列表。"""
    out = []
    try:
        if not os.path.isdir(base):
            return out
        hits = []
        for d in os.listdir(base):
            fp = os.path.join(base, d)
            if not os.path.isdir(fp):
                continue
            files = sorted(f for f in os.listdir(fp)
                           if f.lower().endswith(exts) and '_thumb.' not in f.lower())
            if not files:
                continue
            try:
                mt = os.path.getmtime(fp)
            except OSError:
                continue
            hits.append((mt, d, files))
        hits.sort(reverse=True)
        for mt, d, files in hits[:limit]:
            urls = ['%s/%s/%s' % (media_prefix, d, f) for f in files]
            out.append({'name': d, 'count': len(files), 'items': urls,
                        'first_url': urls[0], 'mtime': mt})
    except Exception:
        pass
    return out


def _video_thumb(d, video_file):
    """为目录下第一个视频抽第一帧生成 _thumb.jpg（缓存：已存在则直接复用，避免每次重抽）。"""
    try:
        thumb = os.path.join(VIDEOS_DIR, d, '_thumb.jpg')
        if not os.path.exists(thumb):
            src = os.path.join(VIDEOS_DIR, d, video_file)
            if not os.path.isfile(src):
                return ''
            r = subprocess.run(
                ['ffmpeg', '-y', '-ss', '0.1', '-i', src, '-frames:v', '1', '-q:v', '3', thumb],
                capture_output=True, timeout=30)
            if r.returncode != 0 or not os.path.exists(thumb):
                return ''
        return 'media/%s/_thumb.jpg' % d
    except Exception:
        return ''


def _video_history_list(limit=50):
    lst = _dir_history_list(VIDEOS_DIR, ('.mp4', '.mov', '.webm', '.m4v'), 'media', limit)
    for h in lst:
        h['thumb'] = _video_thumb(h['name'], os.path.basename(h['items'][0]))
    return lst


def _img_history_list(limit=50):
    lst = _dir_history_list(IMAGES_DIR, ('.png', '.jpg', '.jpeg', '.webp'), 'image', limit)
    for h in lst:          # 兼容前端已有字段 thumb/urls
        h['thumb'] = h['first_url']
        h['urls'] = h['items']
    return lst


def job_snapshot(job):
    with job.lock:
        segs = {}
        for k, v in job.segments.items():
            item = dict(v)
            if item.get('file') and os.path.exists(item['file']):
                item['url'] = '/media/%s/%s' % (os.path.basename(job.run_dir), os.path.basename(item['file']))
            else:
                item['url'] = None
            item['file'] = os.path.basename(item['file']) if item.get('file') else None
            item.setdefault('prompt', None)
            segs[str(k)] = item
        return {
            'id': job.id,
            'status': job.status,
            'cfg': {k: job.cfg.get(k) for k in
                    ('workflow_id', 'mode', 'duration', 'resolution', 'instance', 'concurrency')
                    if k in job.cfg},
            'segments': segs,
            'final_url': job.final_url,
            'final_name': os.path.basename(job.final_path) if job.final_path else None,
            'log_len': len(job.logs),
        }

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json'):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith('text/') or ctype == 'application/json' else ''))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, fp, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(os.path.getsize(fp)))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        with open(fp, 'rb') as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except Exception:
                    break

    def do_GET(self):
        if self.path == '/api/img_workflows':
            self._send(200, json.dumps({'code': 0, 'list': _img_workflows_json()}))
            return
        if self.path == '/api/model_lock':
            self._send(200, json.dumps({'code': 0, 'lock': dict(MODEL_LOCK)}))
            return
        if self.path == '/api/param_lock':
            self._send(200, json.dumps({'code': 0, 'lock': PARAM_LOCK}))
            return
        if self.path == '/api/voices':
            self._send(200, json.dumps({'code': 0, 'voices': VOICE_IDS}))
            return
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)   # 浏览器 %E6.. 百分号解码
        try:
            path = path.encode('latin-1').decode('utf-8')   # curl 原样中文 latin-1 乱码还原
        except Exception:
            pass
        if path.startswith('/openapi/v2/'):
            # RunningHub Model API 兼容层健康检查（GET 形式，防第三方探测 404）
            self._send(200, json.dumps({'status': 'ok', 'service': 'runninghub-workflow-bridge',
                                        'models': list(RH_IMAGE_MODELS) + list(RH_VIDEO_MODELS)}))
            return
        if path.startswith('/image/') or path.startswith('/refs/') or path.startswith('/audio/'):
            fp = os.path.normpath(os.path.join(WEB_ROOT, path.lstrip('/')))
            if not fp.startswith(WEB_ROOT) or not os.path.isfile(fp):
                self._send(404, 'not found', 'text/plain')
                return
            ext = os.path.splitext(fp)[1].lower()
            ct = {'png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
                  '.flac': 'audio/flac', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
                  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma'}.get(ext, 'application/octet-stream')
            # 音频文件内联播放（audio 元素）；图片/其他附件下载
            if ext in ('.flac', '.wav', '.mp3', '.ogg', '.m4a', '.aac', '.wma'):
                disp = "inline; filename*=UTF-8''%s" % urllib.parse.quote(os.path.basename(fp))
            else:
                disp = "attachment; filename*=UTF-8''%s" % urllib.parse.quote(os.path.basename(fp))
            size = os.path.getsize(fp)
            rng = self.headers.get('Range', '')
            m = re.match(r'bytes=(\d*)-(\d*)', rng) if rng else None
            if m and (m.group(1) or m.group(2)):
                start = int(m.group(1)) if m.group(1) else size - int(m.group(2))
                end = (int(m.group(2)) if m.group(2) else size - 1) if m.group(2) or m.group(1) else size - 1
                if start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % size)
                    self.end_headers()
                    return
                end = min(end, size - 1)
                self.send_response(206)
                self.send_header('Content-Type', ct)
                self.send_header('Content-Disposition', disp)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
                self.send_header('Content-Length', str(end - start + 1))
                self.end_headers()
                with open(fp, 'rb') as f:
                    f.seek(start)
                    self.wfile.write(f.read(end - start + 1))
                return
            self.send_response(200)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Disposition', disp)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(size))
            self.end_headers()
            with open(fp, 'rb') as f:
                self.wfile.write(f.read())
            return
        if path == '/':
            # 无版本指纹 → 302 到带时间戳指纹 URL，强制绕过浏览器（尤其 Safari）旧页面缓存。
            # 带 ?v= 的请求直接渲染（不再重定向，避免循环）。
            if 'v=' not in parsed.query:
                _fp = '/?v=%s' % int(time.time())
                self.send_response(302)
                self.send_header('Location', _fp)
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Pragma', 'no-cache')
                self.end_headers()
                return
            # 带旧指纹（超过 5 分钟）的页面请求 → 302 到最新指纹，Safari 等浏览器无法停留旧缓存页
            # 指纹用 epoch 秒（10 位，当前 ~17 亿级），差值即真实秒数；旧版误用 %m%d%H%M%S 拼接整数，
            # 跨分钟/小时进位时差值突变（如 215959→220001 十进制差 4042，实际仅 2 秒）导致页面被反复 302 刷新。
            # 兼容：浏览器仍停留旧格式 MMddHHMMSS 指纹（10 位但 <10 亿）时直接渲染，不按 epoch 误判，避免旧 tab 循环刷新。
            _vm = re.search(r'v=(\d{10})', parsed.query or '')
            if _vm:
                try:
                    _t = int(_vm.group(1))
                    if _t < 1500000000:
                        pass  # 旧格式 MMddHHMMSS 指纹（最大 12.3 亿）：直接渲染
                    elif int(time.time()) - _t > 300:
                        _fp = '/?v=%s' % int(time.time())
                        self.send_response(302)
                        self.send_header('Location', _fp)
                        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                        self.send_header('Pragma', 'no-cache')
                        self.end_headers()
                        return
                except Exception:
                    pass
            html_path = os.path.join(BASE, 'H3生成工作台.html')
            if not os.path.exists(html_path):
                self._send(500, 'HTML 文件缺失: %s' % html_path, 'text/plain')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.end_headers()
            _html = open(html_path, encoding='utf-8').read()
            _ver = 'v1.3-' + time.strftime('%m%d%H%M')
            _html = _html.replace('</title>', '</title><meta name="build-ver" content="'+_ver+'">')
            self.wfile.write(_html.encode('utf-8'))
        elif path == '/api/ping':
            self._send(200, json.dumps({'ok': True, 'time': time.time(), 'websocket': websocket is not None}))
        elif path == '/api/status':
            jid = urllib.parse.parse_qs(parsed.query).get('job', [''])[0]
            job = JOBS.get(jid)
            if not job:
                self._send(404, json.dumps({'error': 'job not found'}))
                return
            self._send(200, json.dumps(job_snapshot(job)))
        elif path == '/api/log':
            q = urllib.parse.parse_qs(parsed.query)
            jid = q.get('job', [''])[0]
            since = int(q.get('since', ['0'])[0] or 0)
            job = JOBS.get(jid)
            if not job:
                # 无 job：返回服务级日志（重启后清空），前端运行日志面板空闲时显示
                lines = [m for i, m in SYS_LOG if i >= since]
                nxt = since + len(lines)
                if SYS_LOG and nxt <= SYS_LOG[-1][0]:
                    nxt = SYS_LOG[-1][0] + 1
                self._send(200, json.dumps({'since': nxt, 'lines': lines, 'syslog': True}))
                return
            with job.lock:
                lines = job.logs[since:]
            self._send(200, json.dumps({'since': since + len(lines), 'lines': lines}))
        elif path == '/api/jobs':
            # 只返回当前内存任务（运行中/本次会话生成的）；历史完成视频改为用户点「视频历史记录」手动加载，
            # 刷新页面后不再默认一直显示（与图片历史记录加载逻辑一致）。
            snapshots = [job_snapshot(j) for j in JOBS.values()]
            self._send(200, json.dumps({'jobs': snapshots}))
        elif path == '/api/video_history':
            self._send(200, json.dumps({'list': _video_history_list()}))
        elif path == '/api/img_history':
            self._send(200, json.dumps({'list': _img_history_list()}))
        elif path == '/api/img_dirs_recent':
            """列出最近有更新的图片目录，供第三方（huobao-drama 火宝）按时间窗匹配孤儿任务。
            入参：X-Since-Ts（unix 时间戳），仅返回 ctime >= since 的目录；since=0 时默认取过去 24h。
            返回：{ok, count, dirs: [{name, dir, created_at, modified_at, urls: [...]}, ...]}，按 created_at 升序。"""
            try:
                since = float(self.headers.get('X-Since-Ts') or '0')
            except Exception:
                since = 0.0
            cutoff = since if since > 0 else (time.time() - 86400)
            out = []
            base = IMAGES_DIR
            if os.path.isdir(base):
                for d in os.listdir(base):
                    full = os.path.join(base, d)
                    if not os.path.isdir(full):
                        continue
                    try:
                        ct = os.path.getctime(full)
                        mt = os.path.getmtime(full)
                    except OSError:
                        continue
                    if ct >= cutoff - 30:
                        files = sorted(f for f in os.listdir(full)
                                       if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))
                                       and '_thumb.' not in f.lower())
                        out.append({
                            'name': d,
                            'dir': 'image/' + d,
                            'created_at': ct,
                            'modified_at': mt,
                            'urls': ['image/' + d + '/' + f for f in files],
                        })
            out.sort(key=lambda x: x['created_at'])
            self._send(200, json.dumps({'ok': True, 'count': len(out), 'dirs': out}))
        elif path.startswith('/media/'):
            parts = path.split('/')
            if len(parts) >= 4:
                run_dir = parts[2]
                fn = '/'.join(parts[3:])
                base = os.path.abspath(VIDEOS_DIR)
                fp = os.path.abspath(os.path.join(base, run_dir, fn))
                if fp.startswith(base + os.sep) and os.path.exists(fp) and os.path.isfile(fp):
                    self._send_file(fp, mimetypes.guess_type(fp)[0] or 'application/octet-stream')
                    return
            self._send(404, b'not found', 'text/plain')
        else:
            self._send(404, b'not found', 'text/plain')

    def _read_body(self):
        length = int(self.headers.get('Content-Length', '0') or 0)
        return self.rfile.read(length) if length else b''

    def do_OPTIONS(self):
        # CORS 预检（供浏览器直连开放 API）
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/api/video_history_del' or path == '/api/img_history_del':
            # 历史记录删除：只允许删除产物目录下的直接子目录（名字=本地文件夹名），防止路径穿越
            try:
                body = json.loads(self._read_body().decode('utf-8'))
            except Exception:
                self._send(400, json.dumps({'error': 'bad json'}))
                return
            name = str(body.get('dir') or body.get('name') or '')
            if not name or not re.match(r'^[\w\-]+$', name):
                self._send(400, json.dumps({'error': '非法目录名'}))
                return
            base = VIDEOS_DIR if path == '/api/video_history_del' else IMAGES_DIR
            target = os.path.abspath(os.path.join(base, name))
            if not target.startswith(os.path.abspath(base) + os.sep) or not os.path.isdir(target):
                self._send(404, json.dumps({'error': '目录不存在'}))
                return
            try:
                import shutil
                shutil.rmtree(target)
            except Exception as e:
                self._send(500, json.dumps({'error': str(e)}))
                return
            _emit('[历史] 已删除 %s 目录 %s（%s）' % ('视频' if path == '/api/video_history_del' else '图片', name, base))
            self._send(200, json.dumps({'ok': True}))
            return
        if path.startswith('/openapi/v2/'):
            # ===== RunningHub Model API 兼容层（免扣费，供 huobao-drama 等第三方调用） =====
            if path == '/openapi/v2/img-workflows':
                self._send(200, json.dumps({'code': 0, 'list': _img_workflows_json()}))
                return
            if path == '/openapi/v2/query':
                try:
                    body = json.loads(self._read_body().decode('utf-8'))
                except Exception:
                    self._send(400, json.dumps({'error': 'bad json'}))
                    return
                tid = str(body.get('taskId') or body.get('task_id') or '')
                ent = RH_OPENAPI.get(tid)
                if not ent:
                    self._send(200, json.dumps({'status': 'FAILED', 'message': 'unknown taskId: ' + tid}))
                    return
                if ent['kind'] == 'image':
                    st, urls, local, th, logs = img_poll(ent['task_id'], ent['api_key'])
                    _emit('[开放API] query %s img_poll=%s local=%s' % (tid, st, (len(local or []) if isinstance(local, list) else local)))
                    if st == 'finished' and local:
                        # 本地产物目录优先（WS 已落盘），避免 CDN 直链导致第三方下载超时
                        _lp = next((x for x in local if (x or '').startswith('/')), None)
                        u = _rh_abs(_lp if _lp else (local[0] if local else ''))
                        self._send(200, json.dumps({'status': 'SUCCESS', 'image_url': u,
                                                    'output': {'image_url': u}, 'url': u}))
                    elif st == 'failed':
                        self._send(200, json.dumps({'status': 'FAILED',
                                                    'message': (logs[-1] if logs else '图片生成失败')}))
                    else:
                        self._send(200, json.dumps({'status': 'PROCESSING', 'taskId': tid}))
                else:
                    job = JOBS.get(ent['job_id'])
                    if not job:
                        self._send(200, json.dumps({'status': 'FAILED', 'message': 'job lost'}))
                        return
                    snap = job_snapshot(job)
                    stt = snap.get('status')
                    if stt == 'finished' and snap.get('final_url'):
                        u = _rh_abs(snap['final_url'])
                        self._send(200, json.dumps({'status': 'SUCCESS', 'video_url': u,
                                                    'output': {'video_url': u}, 'url': u}))
                    elif stt in ('failed', 'stopped'):
                        self._send(200, json.dumps({'status': 'FAILED', 'message': '视频任务失败: ' + str(stt)}))
                    else:
                        self._send(200, json.dumps({'status': 'PROCESSING', 'taskId': tid}))
                return
            # 提交：POST /openapi/v2/{model}
            model = path.rsplit('/', 1)[-1]
            try:
                body = json.loads(self._read_body().decode('utf-8'))
            except Exception as e:
                self._send(400, json.dumps({'error': 'bad json: %s' % e}))
                return
            key = ''
            auth = self.headers.get('Authorization', '')
            if auth.lower().startswith('bearer '):
                key = auth[7:].strip()
            if not key:
                self._send(400, json.dumps({'error': '缺少 Authorization: Bearer <apiKey>'}))
                return
            if model in RH_IMAGE_MODELS:
                _wid = str(body.get('workflow_id') or body.get('wf') or '')
                # 默认模型锁定：锁定后外部 API 只能调用锁定的图片工作流
                if MODEL_LOCK.get('image'):
                    _wid = MODEL_LOCK['image']
                if _wid not in IMG_WF_REGISTRY:
                    _wid = RH_IMG_WFID
                cfg = {
                    'workflow_id': _wid, 'api_key': key,
                    'instance': body.get('instance') or 'plus',
                    'prompt': body.get('prompt') or '',
                    'mode': 'i2i' if (body.get('refs') or []) else 't2i', 'optimize': False,
                    'ratio': _rh_map_ratio(body.get('size') or body.get('ratio')),
                    'megapixels': float(body.get('megapixels') or body.get('pixels') or 2),
                    'batch': int(body.get('n') or body.get('batch') or body.get('num') or 1),
                    'refs': [r for r in (body.get('refs') or []) if r],
                }
                try:
                    tid, logs, nw = img_submit(cfg)
                except Exception as e:
                    self._send(500, json.dumps({'error': str(e)}))
                    return
                RH_OPENAPI[str(tid)] = {'kind': 'image', 'api_key': key, 'task_id': str(tid)}
                _save_state()   # 持久化：8765 重启后第三方 query 该 taskId 仍能命中 image 分支
                _emit('[开放API] 图片已提交 %s（model=%s）' % (tid, model))
                threading.Thread(target=img_watch, args=(str(tid), key), daemon=True).start()
                _d = IMG_DIRS.get(str(tid))
                _ld = ('image/' + os.path.basename(_d)) if _d else ''
                self._send(200, json.dumps({'taskId': str(tid), 'task_id': str(tid), 'localDir': _ld}))
            elif model in RH_VIDEO_MODELS:
                prompt = body.get('prompt') or ''
                if not prompt.strip():
                    self._send(400, json.dumps({'error': 'prompt 不能为空'}))
                    return
                _wfid4 = str(body.get('workflow_id') or RH_VIDEO_WFID)
                if MODEL_LOCK.get('video'):
                    _wfid4 = MODEL_LOCK['video']
                _wfc4 = VIDEO_WFS.get(_wfid4, {})
                _ref_cap = len(_wfc4.get('ref_nodes') or REF_NODES)   # 按目标工作流注册的参考图节点数
                # 参考图收集：显式 firstFrameUrl 作为 ref[0]，再依次收集 media 里 reference_image / first_frame。
                # 上限 = 目标工作流 ref_nodes 数（不再硬编码 3）；按 URL 去重（防 main_ref 与 media、media 内部同图重复下载/重复注入）。
                refs = []
                _seen_urls = set()
                _main_url = body.get('firstFrameUrl') or body.get('first_frame') or body.get('imageUrl')
                if _main_url:
                    _seen_urls.add(str(_main_url))
                main_ref = _rh_dl_ref(_main_url)
                if main_ref:
                    refs.append(main_ref)
                if isinstance(body.get('media'), list):
                    for m in body['media']:
                        if len(refs) >= _ref_cap:
                            break
                        if not isinstance(m, dict):
                            continue
                        mt = m.get('type')
                        mu = str(m.get('url') or '')
                        if not (mu and mt in ('first_frame', 'reference_image')):
                            continue
                        if mu in _seen_urls:
                            continue
                        _seen_urls.add(mu)
                        rf = _rh_dl_ref(mu)
                        if rf and rf not in refs:
                            refs.append(rf)
                if not refs:
                    refs = ['']   # cfg.refs[0] 必须存在（后续 build_node_info_list 用 cfg.refs[:N]）
                # shots_per_seg 透传：火宝根据 [Shot N] 数量动态设定（默认 1；>1 时同一段含多个分镜）。
                # 节点 #1490/#1491 控制段内起始分镜和循环次数，shots_per_seg>1 时 8765 内部按多段切割去提交。
                # 2026-10-21：兼容火宝适配器实际发送的字段名 shots_per_segment（runninghub-video.ts）
                # —— 此前两边字段名不一致（桥只读 shots_per_seg），导致火宝传的值被静默丢弃。
                shots_per_seg = max(1, int(body.get('shots_per_seg') or body.get('shots_per_segment') or 1))
                # 提示词裁剪：仅 shots_per_seg>1（段内含多个分镜）时保留前 shots_per_seg 个 [Shot N]，
                # 供画布 #1490/#1491 段内起始分镜逻辑使用。
                # shots_per_seg=1（全局自动切分，火宝默认）：不裁剪 → 完整提示词原样提交，
                # count_shots 按全部 [Shot N] 计算 → 503≥2 正常提交（2026-10-19 修复：裁剪到 1 分镜会
                # 被 "1 分镜 < 2 段所需 3 分镜" 拒绝，火宝提交永远失败）。
                # Ref2VA 兼容：retention_analysis 里也会出现 "(appears in [Shot 1]、[Shot 2])" 这类行内
                # [Shot N] 文本，若全匹配会把裁剪点算错、提示词被剪断。因此优先按「行首的 [Shot N]」
                # 匹配（Ref2VA 的 detailed_description 每镜独占一行）；找不到再退回行内全匹配（老 I2VA 格式）。
                _shot_idxs = [m.start() for m in re.finditer(r'(?m)^\s*\[Shot\s+\d+\]', prompt)]
                if not _shot_idxs:
                    _shot_idxs = [m.start() for m in re.finditer(r'\[Shot\s+\d+\]', prompt)]
                if shots_per_seg > 1 and _shot_idxs:
                    _head = prompt[:_shot_idxs[0]].rstrip()
                    if shots_per_seg >= len(_shot_idxs):
                        _rest = prompt[_shot_idxs[0]:]
                    else:
                        _end = _shot_idxs[shots_per_seg]
                        _rest = prompt[_shot_idxs[0]:_end].rstrip()
                    prompt = (_head + '\n' if _head else '') + _rest
                elif not _shot_idxs:
                    prompt = '[Shot 1] ' + prompt.strip()
                if MODEL_LOCK.get('video'):
                    pass   # _wfid4 已在参考图收集前解析（含模型锁定），此处不再重复
                # 参数锁定：开启时外部调用强制跟随导演台参数（覆盖调用方传入的清晰度/比例）
                _pl_v = PARAM_LOCK.get('video') or {}
                if _pl_v.get('locked'):
                    _res_use = float(_pl_v.get('resolution') or 0.4)
                    _ar_use = str(_pl_v.get('aspect_ratio') or 'match')
                else:
                    _res_use = float(body.get('resolution') or body.get('clarity') or 0.2)
                    _ar_use = str(body.get('aspect_ratio') or 'match')
                cfg = {
                    'workflow_id': _wfid4, 'api_key': key,
                    'mode': 'global', 'global_prompt': prompt,
                    'shots_per_seg': shots_per_seg,
                    'duration': int(body.get('duration') or 15),
                    'resolution': _res_use,
                    'instance': body.get('instance') or 'plus',
                    'aspect_ratio': _ar_use,
                    'refs': refs, 'submit_gap': 0.5, 'llm': False,
                    # 2026-10-21：透传火宝 UI 选择的总段数。
                    # 此前 cfg 里没有 target_segs → det16 分支 `cfg.get('target_segs') or 16`
                    # 恒从 16 起步，再被分镜数自动降级 → 火宝选 2 段与"自动降出来的 2 段"
                    # 混在一起，段数完全由分镜数决定而非用户选择（用户反馈"选了两段"）。
                    'target_segs': int(body.get('target_segs') or 0) or None,
                    # 2026-10-19 修复（第3轮）：开放API（火宝）来源标记 → run_job 内 502=false 干净版防爆窗；
                    # 导演台 /api/start 无此标记 → 502 走 wfc 默认（原有逻辑，禁止修改）。
                    '_from_openapi': True,
                }
                if cfg['target_segs'] is None:
                    cfg.pop('target_segs', None)
                job = Job(cfg)
                with JOBS_LOCK:
                    JOBS[job.id] = job
                job.thread = threading.Thread(target=run_job, args=(job,), daemon=True)
                job.thread.start()
                RH_OPENAPI[job.id] = {'kind': 'video', 'job_id': job.id, 'api_key': key}
                _emit('[开放API] 视频已提交 %s（model=%s，refs=%d，shots_per_seg=%d）'
                      % (job.id, model, len([r for r in refs if r]), shots_per_seg))
                self._send(200, json.dumps({'taskId': job.id, 'task_id': job.id}))
            else:
                self._send(400, json.dumps({'error': '未知模型: %s（支持 %s）'
                                            % (model, list(RH_IMAGE_MODELS) + list(RH_VIDEO_MODELS))}))
            return
        if path == '/api/model_lock':
            try:
                body = json.loads(self._read_body().decode('utf-8'))
            except Exception:
                self._send(400, json.dumps({'error': 'bad json'}))
                return
            kind = str(body.get('kind') or '')
            if kind not in ('image', 'video'):
                self._send(400, json.dumps({'error': 'kind 必须是 image 或 video'}))
                return
            wid = str(body.get('workflow_id') or '').strip()
            if not wid or wid.lower() in ('null', 'none', ''):
                MODEL_LOCK[kind] = None
            else:
                # 校验工作流是否已登记：图片查 IMG_WF_REGISTRY，视频查 VIDEO_WFS
                _ok = wid in IMG_WF_REGISTRY if kind == 'image' else wid in VIDEO_WFS
                if not _ok:
                    self._send(400, json.dumps({'error': '未登记的工作流 id: %s' % wid}))
                    return
                MODEL_LOCK[kind] = wid
            _save_state()
            _emit('[模型锁定] %s 默认模型%s：%s'
                  % (kind, '锁定为' if MODEL_LOCK[kind] else '已解除', MODEL_LOCK[kind] or '（未锁定）'))
            self._send(200, json.dumps({'code': 0, 'lock': dict(MODEL_LOCK)}))
            return
        if path == '/api/param_lock':
            try:
                body = json.loads(self._read_body().decode('utf-8'))
            except Exception:
                self._send(400, json.dumps({'error': 'bad json'}))
                return
            kind = str(body.get('kind') or '')
            if kind not in PARAM_LOCK:
                self._send(400, json.dumps({'error': 'kind 必须是 image 或 video'}))
                return
            locked = bool(body.get('locked'))
            ent = PARAM_LOCK[kind]
            ent['locked'] = locked
            if kind == 'video':
                if locked:
                    try:
                        ent['resolution'] = float(body.get('resolution') or ent.get('resolution') or 0.4)
                    except Exception:
                        ent['resolution'] = 0.4
                    ent['aspect_ratio'] = str(body.get('aspect_ratio') or ent.get('aspect_ratio') or 'match')
            else:
                if locked:
                    try:
                        ent['resolution'] = float(body.get('resolution') or ent.get('resolution') or 2.0)
                    except Exception:
                        ent['resolution'] = 2.0
            _save_state()
            _emit('[参数锁定] %s 参数%s：%s'
                  % (kind, '锁定为' if locked else '已解除', ent if locked else '（未锁定）'))
            self._send(200, json.dumps({'code': 0, 'lock': PARAM_LOCK}))
            return
        if path == '/api/upload_refs':
            ctype = self.headers.get('Content-Type', '')
            m = re.search(r'boundary=(.+)', ctype)
            if not m:
                self._send(400, json.dumps({'error': 'no boundary'}))
                return
            boundary = m.group(1).strip().strip('"')
            data = self._read_body()
            saved = []
            for part in data.split(('--' + boundary).encode()):
                if b'filename="' not in part:
                    continue
                try:
                    head, _, content = part.partition(b'\r\n\r\n')
                    fm = re.search(rb'name="(\w+)"', head)
                    ff = re.search(rb'filename="([^"]+)"', head)
                    if fm and ff:
                        fname = ff.group(1).decode('utf-8', 'replace')
                        ext = os.path.splitext(fname)[1].lower()
                        if ext not in ('.jpg', '.jpeg', '.png', '.webp', '.bmp'):
                            continue
                        key = fm.group(1).decode()
                        dest = os.path.join(REFS_DIR, key + ext)
                        with open(dest, 'wb') as f:
                            f.write(content.rstrip(b'\r\n'))
                        saved.append({'key': key, 'path': dest, 'name': fname})
                except Exception as e:
                    print('part parse err', e)
            self._send(200, json.dumps({'saved': saved}))
        elif path == '/api/delete_ref':
            try:
                body = json.loads(self._read_body().decode('utf-8'))
                idx = int(body.get('ref') or 0)
                kind = str(body.get('kind') or 'video')
            except Exception as e:
                self._send(400, json.dumps({'error': 'bad json: %s' % e}))
                return
            key = 'ref%d' % idx if kind == 'video' else 'img_ref%d' % idx
            if idx < 1 or idx > 7:
                self._send(400, json.dumps({'error': 'ref 编号需在 1-7' }))
                return
            hits = list(_g.glob(os.path.join(REFS_DIR, key + '.*')))
            deleted = []
            for p in hits:
                try:
                    os.remove(p)
                    deleted.append(os.path.basename(p))
                except Exception as e:
                    _emit('[删除参考图] 删除 %s 失败: %s' % (p, e))
            _emit('[删除参考图] %s: 删除 %d 个文件 %s' % (key, len(deleted), deleted))
            self._send(200, json.dumps({'ok': True, 'deleted': deleted}))
        elif path == '/api/start':
            try:
                cfg = json.loads(self._read_body().decode('utf-8'))
            except Exception as e:
                self._send(400, json.dumps({'error': 'bad json: %s' % e}))
                return
            # 参考图路径映射：只认本次手动上传的编号（uploadedRefs），绝不扫描 refs/ 目录历史残留
            # （用户铁律：参考图只接收前端手动上传的；refs/ 目录可能残留历史 ref1..refN，禁止拾取）
            up = [int(x) for x in (cfg.get('uploadedRefs') or []) if str(x).isdigit()]
            refs = []
            for i in range(1, 8):
                if i in up:
                    hits = list(_g.glob(os.path.join(REFS_DIR, 'ref%d.*' % i)))
                    if hits:
                        hits.sort(key=lambda p: os.path.getmtime(p), reverse=True)
                        refs.append(hits[0])
                    else:
                        refs.append('')
                else:
                    refs.append('')
            cfg['refs'] = refs
            cfg.setdefault('mode', 'global')
            cfg.setdefault('duration', 15)
            cfg.setdefault('resolution', 0.2)
            cfg.setdefault('instance', 'plus')
            cfg.setdefault('submit_gap', 0.5)
            cfg.setdefault('llm', False)   # 节点502 LLM 提示词优化开关（默认关）
            if not cfg.get('api_key') or not cfg.get('workflow_id'):
                self._send(400, json.dumps({'error': 'api_key 与 workflow_id 必填'}))
                return
            job = Job(cfg)
            with JOBS_LOCK:
                JOBS[job.id] = job
            job.thread = threading.Thread(target=run_job, args=(job,), daemon=True)
            job.thread.start()
            self._send(200, json.dumps({'job_id': job.id, 'run_dir': job.run_dir,
                                        'refs': [r for r in refs if r]}))
        elif path == '/api/img_workflows':
            self._send(200, json.dumps({'code': 0, 'list': _img_workflows_json()}))
        elif path == '/api/img_gen':
            try:
                cfg = json.loads(self._read_body().decode('utf-8'))
            except Exception as e:
                self._send(400, json.dumps({'error': 'bad json: %s' % e}))
                return
            if not cfg.get('api_key') or not cfg.get('workflow_id'):
                self._send(400, json.dumps({'error': 'api_key 与 workflow_id 必填'}))
                return
            # 图片参考图路径映射：只认前端本次手动上传的槽位（imgUploadedRefs），
            # 绝不扫描 refs/ 目录历史残留（对齐视频 /api/start 的 uploadedRefs 铁律；
            # 残留 img_refN.* 会导致"只传1张却注入N张"）
            up = [int(x) for x in (cfg.get('imgUploadedRefs') or []) if str(x).isdigit()]
            refs = []
            for i in range(1, 4):
                if i in up:
                    hits = list(_g.glob(os.path.join(REFS_DIR, 'img_ref%d.*' % i)))
                    if hits:
                        hits.sort(key=lambda p: os.path.getmtime(p), reverse=True)
                        refs.append(hits[0])
                    else:
                        refs.append('')
                else:
                    refs.append('')
            cfg['refs'] = refs
            cfg.setdefault('mode', 't2i')
            cfg.setdefault('optimize', False)
            cfg.setdefault('ratio', '9:16 (Portrait Widescreen)')
            cfg.setdefault('megapixels', 2)
            cfg.setdefault('batch', 1)
            cfg.setdefault('instance', 'plus')
            cfg.setdefault('batch_tag', None)   # 批量脚本：同一批次统一产物目录（年月日+8位随机）
            cfg.setdefault('shot_tag', None)    # 批量脚本：镜头前缀（镜头1/镜头2…）
            try:
                tid, img_logs, _nw3 = img_submit(cfg)
                IMG_LOGS[tid] = img_logs
                IMG_TASKS[tid] = {'cfg': cfg, 'status': 'submitted', 'urls': []}
                self._send(200, json.dumps({'ok': True, 'task_id': tid, 'mode': cfg.get('mode')}))
            except Exception as e:
                _emit('[图片] 提交失败: %s' % e)
                self._send(500, json.dumps({'error': str(e)}))
        elif path == '/api/img_fix':
            body = json.loads(self._read_body().decode())
            tag = str(body.get('dir') or body.get('batch_tag') or '').strip()
            local_urls, local_thumbs = [], []
            if tag:
                d = os.path.join(IMAGES_DIR, tag)
                if os.path.isdir(d):
                    files = sorted(f for f in os.listdir(d) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and '_thumb.jpg' not in f)
                    for fn in files:
                        local_urls.append('/image/' + tag + '/' + fn)
                        thf = os.path.splitext(fn)[0] + '_thumb.jpg'
                        local_thumbs.append('/image/' + tag + '/' + thf if os.path.exists(os.path.join(d, thf)) else ('/image/' + tag + '/' + fn))
            self._send(200, json.dumps({'ok': True, 'dir': tag, 'local_urls': local_urls, 'local_thumbs': local_thumbs}))
        elif path == '/api/audio_gen':
            body = json.loads(self._read_body().decode())
            try:
                tid, logs = audio_submit(body)
                self._send(200, json.dumps({'ok': True, 'task_id': tid, 'logs': logs}))
            except Exception as e:
                self._send(400, json.dumps({'error': str(e)}))
        elif path == '/api/audio_poll':
            body = json.loads(self._read_body().decode())
            task_id = str(body.get('task_id'))
            api_key = body.get('api_key')
            if not task_id or not api_key:
                self._send(400, json.dumps({'error': 'task_id/api_key 必填'}))
                return
            status, urls, local_urls, err, audio_logs = audio_poll(task_id, api_key)[:5]
            if local_urls is None:
                local_urls = []
            self._send(200, json.dumps({'task_id': task_id, 'status': status,
                                        'urls': urls or [], 'local_urls': local_urls,
                                        'error': err, 'logs': audio_logs}))
        elif path == '/api/audio_merge':
            body = json.loads(self._read_body().decode())
            try:
                files = [os.path.join(WEB_ROOT, f.lstrip('/')) if f.startswith('/') else f for f in (body.get('files') or []) if f]
                tag = str(body.get('batch_tag') or '')
                out_dir = os.path.join(WEB_ROOT, 'audio', tag) if tag else None
                if not out_dir:
                    raise RuntimeError('缺少 batch_tag')
                merged = audio_merge(files, out_dir)
                self._send(200, json.dumps({'ok': True, 'merged': merged, 'dir': '/audio/' + tag + '/'}))
            except Exception as e:
                self._send(400, json.dumps({'error': str(e)}))
        elif path == '/api/audio_fix':
            body = json.loads(self._read_body().decode())
            tag = str(body.get('dir') or body.get('batch_tag') or '').strip()
            local_urls = []
            if tag:
                d = os.path.join(WEB_ROOT, 'audio', tag)
                if os.path.isdir(d):
                    for fn in sorted(os.listdir(d)):
                        if fn.lower().endswith(('.flac', '.wav', '.mp3', '.ogg')):
                            local_urls.append('/audio/' + tag + '/' + fn)
            self._send(200, json.dumps({'ok': True, 'dir': tag, 'local_urls': local_urls}))
        elif path == '/api/audio_upload':
            ctype = self.headers.get('Content-Type', '')
            m = re.search(r'boundary=(.+)', ctype)
            if not m:
                self._send(400, json.dumps({'error': 'no boundary'}))
                return
            boundary = m.group(1).strip().strip('"')
            data = self._read_body()
            saved = []
            for part in data.split(('--' + boundary).encode()):
                if b'filename="' not in part:
                    continue
                try:
                    head, _, content = part.partition(b'\r\n\r\n')
                    ff = re.search(rb'filename="([^"]+)"', head)
                    if ff:
                        fname = ff.group(1).decode('utf-8', 'replace')
                        ext = os.path.splitext(fname)[1].lower()
                        if ext not in ('.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'):
                            continue
                        body = content.rstrip(b'\r\n')
                        if len(body) < 1000:
                            continue
                        os.makedirs(REFS_DIR, exist_ok=True)
                        fp = os.path.join(REFS_DIR, 'voice_ref' + ext)
                        with open(fp, 'wb') as f:
                            f.write(body)
                        saved.append({'path': fp, 'name': fname, 'size': len(body)})
                except Exception as e:
                    print('audio part parse err', e)
            if not saved:
                self._send(400, json.dumps({'error': '未解析到音频文件'}))
                return
            self._send(200, json.dumps({'ok': True, 'path': saved[0]['path'], 'name': saved[0]['name'],
                                        'size': saved[0]['size']}))
        elif path == '/api/img_poll':
            body = json.loads(self._read_body().decode())
            task_id = str(body.get('task_id'))
            api_key = body.get('api_key')
            if not task_id or not api_key:
                self._send(400, json.dumps({'error': 'task_id/api_key 必填'}))
                return
            status, urls, local_urls, th, img_logs = img_poll(task_id, api_key)
            if local_urls is None:
                local_urls = []
            if th is None:
                th = []
            err = None
            self._send(200, json.dumps({'task_id': task_id, 'status': status,
                                        'urls': urls or [], 'local_urls': local_urls,
                                        'local_thumbs': th, 'error': err, 'logs': img_logs}))
        elif path == '/api/rerun':
            body = json.loads(self._read_body().decode())
            job = JOBS.get(str(body.get('job')))
            if not job:
                self._send(404, json.dumps({'error': 'job not found'}))
                return
            seg = int(body.get('seg', 0) or 0)
            prompt = body.get('prompt', '')
            threading.Thread(target=rerun_seg, args=(job, seg, prompt), daemon=True).start()
            self._send(200, json.dumps({'ok': True, 'seg': seg}))
        elif path == '/api/stop':
            try:
                d = json.loads(self._read_body().decode('utf-8'))
            except Exception:
                d = {}
            job = JOBS.get(d.get('job', ''))
            if job:
                job.stop_flag = True
                self._send(200, json.dumps({'ok': True}))
            else:
                self._send(404, json.dumps({'error': 'job not found'}))
        else:
            self._send(404, b'not found', 'text/plain')

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    if websocket is None:
        print('⚠ 缺少 websocket-client 库，运行: /usr/bin/python3 -m pip install --user websocket-client')
        print('  否则视频只能靠 /view 抢文件兜底（成功率低），建议安装后重启。')
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('H3 生成工作台已启动: http://127.0.0.1:%d/' % port)
    print('按 Ctrl+C 停止')
    try:
        webbrowser.open('http://127.0.0.1:%d/' % port)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止服务')

if __name__ == '__main__':
    main()


def run_job_serial(job):
    """串行执行视频 Job：同一时间只让一个 H3 任务占用 WS/分段运行态。"""
    with VIDEO_JOB_LOCK:
        return run_job(job)
