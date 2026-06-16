"""
MONGGEUL — CHARACTERIZATION: LLM(JSON) 견고 파서 Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  dream.js god-func 안의 LLM-JSON 파서 클러스터(_sliceBalancedJson / parseLLMJson)를
  *현재 동작 그대로* Node 런타임으로 박제한다. services/llm-json-parser.js 로 추출할 때
  슬라이스 경계/리페어 산식/throw 여부가 한 톨이라도 바뀌면 FAIL 하게 만들어 안전화한다.

  이 파서는 유료 상세해몽 경로(analyzeDream)의 LLM 응답을 파싱한다(머니패스 인접).
  추출은 함수 *이동만*(산식 무변경) — DOM/네트워크/Date 무의존 순수 로직이라 안전.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(golden 은 추출 전 원본 로직 probe 로 실측).
  - 소스 문자열 스캔이 아니라 실제 함수를 fake DOM 으로 dream.js import 해 행위를 본다.
  - ★현재 동작 박제(버그 포함): 문자열 내부 raw 개행(0x0A)은 리페어가 같은 개행으로 치환 →
    JSON.parse 여전히 throw. 이 'throw 한다'는 사실 자체를 핀(현재 동작 보존, 개선 아님).

뮤테이션 정신:
  - _sliceBalancedJson 균형 매칭/문자열-내부 중괄호 인지 변경 → 슬라이스 경계 어긋남 → FAIL
  - parseLLMJson 코드펜스 제거/슬라이스/리페어 산식 변경 → 결과/throw 여부 어긋남 → FAIL
  - 추출 시 dream.js 가 자체 사본 유지(권위 분리) → cross 검증 어긋남 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DREAM = ROOT / "src" / "tabs" / "dream.js"
PARSER = ROOT / "src" / "services" / "llm-json-parser.js"


# ── 공용 브라우저 쉼(SHIM) — dream.js 의 큰 전이 의존 그래프 대비 ──
_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { _s:new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)}, clear(){this._s.clear()} };
const _cap = {};
function capEl(id){
  return {
    id, style:{cssText:'',display:''},
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(){}, getAttribute(){return null}, addEventListener(){},
    appendChild(){}, prepend(){}, insertBefore(){}, remove(){},
    querySelector(){return null}, querySelectorAll(){return []},
    getContext(){ return { fillRect(){},clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},save(){},restore(){},translate(){},rotate(){},fillText(){},measureText(){return {width:0}} }; },
    get innerHTML(){ return _cap[id]||''; }, set innerHTML(v){ _cap[id]=v; },
    textContent:'', value:'', offsetWidth:0, parentElement:null, dataset:{}, scrollIntoView(){},
  };
}
const _els = {};
globalThis.document = {
  getElementById:(id)=>{ _els[id]=_els[id]||capEl(id); return _els[id]; },
  querySelector:()=>null, querySelectorAll:()=>[],
  createElement:()=>capEl('_new'), addEventListener:()=>{},
  body:capEl('body'), documentElement:capEl('html'),
};
globalThis.window = globalThis;
globalThis.window.location = { search:'', pathname:'/', href:'/' };
globalThis.window.history = { replaceState(){}, pushState(){}, back(){} };
globalThis.addEventListener=()=>{};
globalThis.removeEventListener=()=>{};
globalThis.requestAnimationFrame=()=>{};
globalThis.gtag=()=>{};
try{ Object.defineProperty(globalThis,'navigator',{configurable:true,value:{ userAgent:'node-test', language:'ko', clipboard:{writeText:()=>Promise.resolve()} }}); }catch(_){ }
globalThis.fetch=()=>Promise.reject(new Error('no-net-in-test'));
"""

_RUNTIME = _SHIM + r"""
import fs from 'node:fs';
const dream = await import(DREAM_URI);
const out = {};

// ── (A) dream.js 공개 표면에 파서가 재노출되어 있다 ──
out.has = {
  parseLLMJson: typeof dream.parseLLMJson === 'function',
  _sliceBalancedJson: typeof dream._sliceBalancedJson === 'function',
};

// dream.js 재노출이 없으면(추출 전) 행위 단언은 모듈에서 직접 본다.
const P = dream.parseLLMJson;
const S = dream._sliceBalancedJson;

const tryParse = (fn, input) => { try { return {ok:true, val: fn(input)}; } catch(e){ return {ok:false, err: e.constructor.name}; } };

// ── (B) 결정론 동작 실측 박제 (dream.js 재노출 기준) ──
if (P && S) {
  out.parse = {
    fenced: P('```json\n{"a":1,"b":"x"}\n```'),
    prose: P('Here is the result: {"k":"v"} thanks!'),
    trailingGarbage: P('{"x":1}\n}\n."\n}'),
    nested: P('prefix {"o":{"i":[1,2,{"z":3}]},"s":"a}b{c"}'),
    emptyContent: P('{}'),
  };
  out.parseTry = {
    // 문자열 내부 raw 개행: 현재 동작 = throw(리페어가 개행을 개행으로 치환).
    ctrlChar_newline: tryParse(P, '{"t":"line1' + String.fromCharCode(10) + 'line2' + String.fromCharCode(9) + 'tab"}'),
    // null(0x00): cc<=31 & not in ESC -> 제거 -> "ab"
    nullVoid: tryParse(P, '{"t":"a' + String.fromCharCode(0) + 'b"}'),
    // SOH(0x01): 동일하게 제거 -> "ab"
    sohVoid: tryParse(P, '{"t":"a' + String.fromCharCode(1) + 'b"}'),
  };
  out.slice = {
    simple: S('xx{"a":1}yy'),
    nostart: S('no braces here'),
    unbalanced: S('{"a":1'),
    strbrace: S('{"s":"}{}"}TAIL'),
    escaped: S('{"s":"a\\"}"}REST'),
  };
}

// ── (C) 추출 안전망: services/llm-json-parser.js 가 있으면 dream.js 재노출과 결과 동일 ──
out.parser_module_exists = fs.existsSync(PARSER_PATH);
if(out.parser_module_exists){
  const mod = await import(PARSER_URI);
  out.parser_exports = Object.keys(mod).sort();
  const cases = [
    '```json\n{"a":1}\n```', 'pre {"k":"v"} post', '{"x":1}\n}\n."\n}',
    'prefix {"o":{"i":[1,2,{"z":3}]},"s":"a}b{c"}', '{}',
  ];
  out.parser_matches_dream = cases.every(c =>
    JSON.stringify(mod.parseLLMJson(c)) === JSON.stringify(dream.parseLLMJson(c))
  ) && ['xx{"a":1}yy', '{"s":"}{}"}TAIL', 'no braces here'].every(c =>
    mod._sliceBalancedJson(c) === dream._sliceBalancedJson(c)
  );
}

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — LLM-JSON 파서 런타임 핀 skip")
    script = (
        _RUNTIME
        .replace("DREAM_URI", json.dumps(DREAM.resolve().as_uri()))
        .replace("PARSER_URI", json.dumps(PARSER.resolve().as_uri()))
        .replace("PARSER_PATH", json.dumps(str(PARSER.resolve())))
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


@pytest.fixture(scope="module")
def rt():
    return _run()


# ── (A) 공개 표면 ──────────────────────────────────────────────────────
def test_dream_reexports_parser_surface(rt):
    """dream.js 가 파서 함수를 재노출한다(추출 후에도 표면 유지)."""
    has = rt["has"]
    for k in ("parseLLMJson", "_sliceBalancedJson"):
        assert has[k] is True, f"dream.js 에서 {k} 재노출이 사라짐(공개 표면 깨짐)"


# ── (B) parseLLMJson 결정론 박제 ───────────────────────────────────────
def test_parse_fenced_and_prose(rt):
    """코드펜스 제거 + 앞뒤 산문 무시하고 객체 추출."""
    p = rt["parse"]
    assert p["fenced"] == {"a": 1, "b": "x"}, f"코드펜스 파싱 어긋남: {p['fenced']}"
    assert p["prose"] == {"k": "v"}, f"산문 둘러싼 JSON 추출 어긋남: {p['prose']}"


def test_parse_trailing_garbage_stripped(rt):
    """균형 매칭으로 trailing } garbage 방어(진짜 객체만)."""
    assert rt["parse"]["trailingGarbage"] == {"x": 1}, \
        f"trailing garbage 방어 어긋남: {rt['parse']['trailingGarbage']}"


def test_parse_nested_with_string_internal_braces(rt):
    """중첩 객체/배열 + 문자열 내부 중괄호('a}b{c')를 깨뜨리지 않음."""
    assert rt["parse"]["nested"] == {
        "o": {"i": [1, 2, {"z": 3}]}, "s": "a}b{c"
    }, f"중첩/문자열-내부-중괄호 파싱 어긋남: {rt['parse']['nested']}"


def test_parse_empty_object(rt):
    assert rt["parse"]["emptyContent"] == {}


def test_parse_control_char_behavior(rt):
    """★현재 동작 박제(버그 포함):
    - 문자열 내부 raw 개행(0x0A) → 현재 리페어가 못 고침 → throw(SyntaxError).
    - null(0x00)/SOH(0x01) → 제거되어 'ab'.
    이 throw/non-throw 경계가 변하면 FAIL(개선이라도 핀 깨짐 = 의도된 안전망).
    """
    pt = rt["parseTry"]
    assert pt["ctrlChar_newline"] == {"ok": False, "err": "SyntaxError"}, \
        f"raw 개행 throw 동작 변경됨: {pt['ctrlChar_newline']}"
    assert pt["nullVoid"] == {"ok": True, "val": {"t": "ab"}}, \
        f"null 제거 리페어 동작 변경됨: {pt['nullVoid']}"
    assert pt["sohVoid"] == {"ok": True, "val": {"t": "ab"}}, \
        f"SOH 제거 리페어 동작 변경됨: {pt['sohVoid']}"


# ── (B') _sliceBalancedJson 결정론 박제 ────────────────────────────────
def test_slice_balanced_boundaries(rt):
    """슬라이스 경계 박제: 첫 '{'~균형 '}', 문자열-내부 중괄호/이스케이프 인지."""
    s = rt["slice"]
    assert s["simple"] == '{"a":1}', f"단순 슬라이스 어긋남: {s['simple']}"
    assert s["nostart"] == "no braces here", "'{' 없으면 원본 반환(현재 동작)"
    assert s["unbalanced"] == '{"a":1', "균형 못 찾으면 a부터 끝까지(현재 동작)"
    assert s["strbrace"] == '{"s":"}{}"}', f"문자열 내부 중괄호 무시 어긋남: {s['strbrace']}"
    assert s["escaped"] == '{"s":"a\\"}"}', f"이스케이프 따옴표 인지 어긋남: {s['escaped']}"


# ── (C) 추출 안전망: 권위 분리 방지 ─────────────────────────────────────
def test_extracted_module_matches_dream_when_present(rt):
    """services/llm-json-parser.js 가 존재하면 결과가 dream.js 재노출과 완전 동일해야 한다.

    추출 전에는 모듈이 없어 skip. 추출 후 dream.js 가 자체 사본을 유지하면(권위 분리)
    cross 검증이 깨져 FAIL → 안전망.
    """
    if not rt.get("parser_module_exists"):
        pytest.skip("services/llm-json-parser.js 미존재 — 추출 전(이 단언은 추출 후 활성)")
    exp = rt.get("parser_exports", [])
    for k in ("parseLLMJson", "_sliceBalancedJson"):
        assert k in exp, f"llm-json-parser.js 가 {k} 를 export 안 함: {exp}"
    assert rt.get("parser_matches_dream") is True, \
        "추출 모듈이 dream.js 와 다른 값을 냄(권위 분리/로직 변경)"
