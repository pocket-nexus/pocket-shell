// SPDX-License-Identifier: GPL-3.0-or-later
#![cfg(test)]
#![allow(dead_code, unused_unsafe, static_mut_refs)]
//! The program's link and media code (../program/src) on the build machine.
//! PocketJS's PSP composition files (instance.rs, service_bindings.rs) compile
//! here as in PocketJS's tests/fixtures/psp-runtime; device services and the
//! link and media workers are substituted. QuickJS, the generated bindings,
//! the runtime and the core are real. The program names the library
//! `pocketjs_psp`; here that is this crate.
extern crate alloc;
extern crate self as pocketjs_psp;

pub use libquickjs_sys;
#[path = "../../../../vendor/pocketjs/programs/psp/src/service_bindings.rs"]
pub mod service_bindings;
#[path = "../../../../vendor/pocketjs/programs/psp/src/instance.rs"]
mod instance;
pub use instance::with_ui;
/// The program's profile (../pocket-shell-psp.host.json), exported by
/// ../test/host.test.ts.
pub mod profile {
    include!(concat!(env!("OUT_DIR"), "/pocket_profile.rs"));
}
#[path = "../../../../vendor/pocketjs/programs/psp/src/offload_image.rs"]
mod offload_image;

// The program's code under test.
#[path = "../../program/src/bindings.rs"]
mod bindings;
#[path = "../../program/src/link_record.rs"]
mod link_record;
#[path = "../../program/src/media_wire.rs"]
mod media_wire;

/// link.rs without its worker: the `ready` JSON the worker last published.
mod link {
    use std::cell::RefCell;
    thread_local! {
        pub static STARTED: RefCell<Vec<String>> = RefCell::new(Vec::new());
        /// (ready JSON, a companion beats)
        pub static READY: RefCell<(Vec<u8>, bool)> = RefCell::new((Vec::new(), false));
    }
    pub unsafe fn start(target: &str) {
        STARTED.with(|started| started.borrow_mut().push(target.into()));
    }
    pub unsafe fn link_status() -> String {
        READY.with(|ready| {
            let ready = ready.borrow();
            crate::link_record::status_json(&ready.0, ready.1, "0000123456789abc")
        })
    }
}
/// media.rs without its worker: the calls the bindings make, and a real
/// texture upload into the calling guest's Ui.
mod media {
    use std::cell::RefCell;
    thread_local! {pub static CALLS: RefCell<Vec<String>> = RefCell::new(Vec::new());}
    fn note(call: String) {
        CALLS.with(|calls| calls.borrow_mut().push(call));
    }
    pub unsafe fn open(token: &[u8]) -> bool {
        note(format!("open {}", String::from_utf8_lossy(token)));
        token.len() == 64
    }
    pub unsafe fn close() {
        note("close".into());
    }
    pub fn set_paused(value: bool) {
        note(format!("paused {value}"));
    }
    pub fn set_volume(value: f32) {
        note(format!("volume {value}"));
    }
    pub unsafe fn texture(ui: &mut pocketjs_core::Ui) -> i32 {
        use pocketjs_core::spec;
        ui.upload_texture_flags(&[255; 4 * 4 * 4], 4, 4, spec::psm::PSM_8888, spec::img::FLAG_LINEAR)
    }
    pub fn status() -> String {
        "{\"phase\":\"idle\",\"h264\":false}".into()
    }
}

// ---- device services the library's files name (as tests/fixtures/psp-runtime) ----
mod dbg {
    pub fn active() -> bool {
        false
    }
    pub fn poll() -> Option<String> {
        None
    }
    pub fn send(_: &[u8]) {}
    pub fn shot() -> bool {
        false
    }
}
mod svc {
    pub fn open(_: &str) -> bool {
        false
    }
    pub fn poll() -> Option<String> {
        None
    }
    pub fn send(_: &[u8]) {}
    pub fn read_side_file(_: &str, _: usize) -> Option<Vec<u8>> {
        None
    }
}
mod vid {
    pub fn open(_: &mut pocketjs_core::Ui, _: &str) -> bool {
        false
    }
    pub fn tick(_: &mut pocketjs_core::Ui) -> i32 {
        -1
    }
    pub fn texture() -> i32 {
        -1
    }
    pub fn close(_: &mut pocketjs_core::Ui) {}
}
mod stats {
    pub fn json() -> String {
        "{}".into()
    }
}
mod qjs_alloc {
    pub unsafe fn new_runtime() -> *mut libquickjs_sys::JSRuntime {
        libquickjs_sys::JS_NewRuntime()
    }
}
mod host {
    use std::sync::atomic::{AtomicU64, Ordering};
    static TIME: AtomicU64 = AtomicU64::new(1);
    pub fn now_us() -> u64 {
        TIME.fetch_add(1, Ordering::Relaxed)
    }
    pub struct FpuGuard;
    impl FpuGuard {
        pub unsafe fn masked() -> Self {
            Self
        }
    }
}
mod audio_mod {
    pub unsafe fn create_stream(_: u32, _: u32) -> i32 {
        1
    }
    pub unsafe fn destroy_stream(_: i32) {}
    pub unsafe fn write_pcm_le(_: i32, bytes: &[u8]) -> i32 {
        (bytes.len() / 2) as i32
    }
    pub unsafe fn play(_: i32) {}
    pub unsafe fn pause(_: i32) {}
    pub unsafe fn stop(_: i32) {}
    pub unsafe fn set_volume(_: i32, _: f64) {}
    pub unsafe fn end_stream(_: i32) {}
    pub unsafe fn poll() -> Option<String> {
        None
    }
}
mod fs_ops {
    pub unsafe fn register_fs(_: *mut libquickjs_sys::JSContext, _: libquickjs_sys::JSValue, _: &str) {}
}
mod pack_ops {
    pub unsafe fn register_pack(_: *mut libquickjs_sys::JSContext, _: libquickjs_sys::JSValue) {}
}
mod offload {
    pub fn enabled() -> bool {
        false
    }
    pub fn start() {}
    pub fn session() -> i32 {
        0
    }
    pub fn submit(_: &[u8]) -> bool {
        false
    }
    pub fn take() -> Option<String> {
        None
    }
}
mod offload_local {
    pub struct Request {
        pub id: u32,
        pub op: u8,
        pub path: [u8; 128],
        pub generation: u32,
        pub slot: u8,
        pub count: u8,
        pub cps: [u32; 4],
    }
    impl Request {
        pub fn empty() -> Self {
            Self { id: 0, op: 0, path: [0; 128], generation: 0, slot: 0, count: 0, cps: [0; 4] }
        }
    }
    pub fn start() {}
    pub fn session() -> i32 {
        0
    }
    pub fn take() -> Option<String> {
        None
    }
    pub fn submit(_: Request) -> bool {
        false
    }
}

// ---- one guest on the canonical runtime (as tests/fixtures/psp-runtime) -----------
use libquickjs_sys::*;
use pocket_drivers::*;
use pocket_runtime::{abi::Handle, Runtime, RuntimeError};
// The archive defines the pocket_runtime_* symbols the C guest calls.
use pocket_archive as _;
use std::{cell::RefCell, rc::Rc};

struct Render;
impl Renderer for Render {
    type Submission = ();
    fn descriptor(&self) -> RendererDescriptor {
        RendererDescriptor::new(&[PixelFormat::Rgba8888], TargetOwnership::DeviceOwned, Synchronization::Deferred, pocketjs_core::spec::DRAW_LIST_VERSION, false).unwrap()
    }
    fn render(&mut self, _: &mut FrameInput<'_>) -> Result<(), RenderError> {
        Ok(())
    }
    fn wait(&mut self, _: &()) -> Result<(), RenderError> {
        Ok(())
    }
    fn retire(&mut self, _: ()) {}
}
struct Display;
impl DisplayOutput for Display {
    type Token = ();
    fn vsync(&mut self) -> VsyncSource {
        VsyncSource::None
    }
    fn descriptor(&self) -> DisplayDescriptor {
        DisplayDescriptor::new(DisplayRole::Primary, 480, 272, PixelFormat::Rgba8888, 480 * 4, TargetOwnership::DeviceOwned)
    }
    fn acquire(&mut self, rect: Rect) -> Result<Target<'_>, DisplayError> {
        Ok(Target::DeviceOwned(DeviceTarget::new(1, rect, PixelFormat::Rgba8888)))
    }
    fn flush(&mut self, _: &[Rect]) -> Result<(), DisplayError> {
        Ok(())
    }
    fn wait(&mut self, _: ()) -> Result<(), DisplayError> {
        Ok(())
    }
}
struct Guest {
    /// Declared first: the instance shuts down before the guest adapter.
    runtime: Box<Handle>,
    guest: Box<instance::Guest>,
    input: Rc<RefCell<instance::Input>>,
}
const PLAN: &[u8] = br#"{"animation":"composited","profile":{"tickHz":60},"viewport":{"logical":[480,272],"presentation":"native","rasterDensity":1},"features":{"link.companion":true,"media.playback":true}}"#;
impl Guest {
    fn call(&self, action: impl FnOnce(&mut Runtime) -> Result<(), RuntimeError>) -> i32 {
        self.runtime.with_runtime(action).map_or_else(pocket_runtime::abi::status_code, |_| 0)
    }
    /// Boot `code` with `globals` as the program's hook (frame::Program::globals).
    unsafe fn boot(code: &[u8], globals: &mut dyn FnMut(*mut JSContext, JSValue)) -> Self {
        let runtime = Handle::new(pocket_runtime::RuntimeConfig {
            profile_hash: profile::PROFILE_HASH,
            host_abi: profile::HOST_ABI,
            heap_limit: 128 << 20,
            frame_buffer_budget: 1,
            profile: profile::profile().unwrap(),
        })
        .unwrap();
        let ops = runtime.op_context();
        ops.add_provider(Box::new(instance::Services)).unwrap();
        let guest = instance::Guest::new(ops, None, "launcher-main".into()).unwrap();
        let input = Rc::new(RefCell::new(instance::Input { analog: 0x8080, ..Default::default() }));
        let mut g = Self { runtime, guest, input };
        let renderer = g.runtime.with_runtime(|r| r.add_renderer(Render)).unwrap();
        assert_eq!(g.call(|r| r.add_display(Display, renderer).map(|_| ())), 0);
        let source = Box::new(instance::InputDriver(g.input.clone()));
        assert_eq!(g.call(|r| r.add_input_source(source)), 0);
        assert_eq!(pocket_runtime::abi::pocket_runtime_set_guest(g.runtime.as_ptr(), &instance::GUEST, (&mut *g.guest as *mut instance::Guest).cast()), 0);
        let identity = pocket_package::embedded::identity("launcher-main", "dev.pocket-shell.host-test", "Host test").unwrap();
        let package = pocket_package::embedded::encode(pocket_package::embedded::EmbeddedPackage {
            host_abi: profile::HOST_ABI,
            profile_hash: profile::PROFILE_HASH,
            identity: &identity,
            plan: PLAN,
            code,
            pak: &[],
        })
        .unwrap();
        assert_eq!(g.call(|r| r.set_package_source(Box::new(pocket_package::source::MemorySource(package)))), 0);
        let status = g.guest.with_globals(globals, || g.call(Runtime::boot_deferred));
        assert_eq!(status, 0, "{}", g.guest.error());
        g
    }
    unsafe fn assert_js(&self, source: &str) {
        let source = std::ffi::CString::new(source).unwrap();
        let v = JS_Eval(self.guest.context, source.as_ptr().cast(), source.as_bytes().len(), c"test".as_ptr(), JS_EVAL_TYPE_GLOBAL as i32);
        if JS_IsException(v) {
            let err = JS_GetException(self.guest.context);
            let text = JS_ToCStringLen2(self.guest.context, std::ptr::null_mut(), err, 0);
            let message = std::ffi::CStr::from_ptr(text).to_string_lossy().into_owned();
            JS_FreeCString(self.guest.context, text);
            JS_FreeValue(self.guest.context, err);
            panic!("{message}");
        }
        JS_FreeValue(self.guest.context, v);
    }
}

/// Moved from PocketJS tests/fixtures/psp-runtime
/// (public_namespace_providers_and_private_extensions_share_one_runtime):
/// the link and media namespaces, now installed by the program's hook.
#[test]
fn the_program_installs_link_and_media_before_the_bundle_evaluates() {
    unsafe {
        let g = Guest::boot(
            br#"if(typeof ui!=='object'||typeof link!=='object'||typeof media!=='object')throw Error('namespaces at evaluation');const s=JSON.parse(link.status());if(s.state!=='searching'||s.companion!==null||s.paired.length!==0||s.error!==''||s.features.length!==0||s.clock!==null||s.device.address!=='usb')throw Error('searching');globalThis.frame=function(){};"#,
            &mut |ctx, global| bindings::install(ctx, global),
        );
        link::STARTED.with(|started| assert_eq!(*started.borrow(), [profile::ID]));
        assert_eq!(profile::ID, "pocket-shell-psp");
        g.assert_js(r#"const token='ab'.repeat(32);const t=media.texture();if(!media.open('127.0.0.1',9000,token)||t<0||JSON.parse(media.status()).h264!==false)throw Error('media');if(media.open('127.0.0.1',9000,'short'))throw Error('short token');media.paused(true);media.volume(0.5);media.close();"#);
        media::CALLS.with(|calls| {
            assert_eq!(*calls.borrow(), [format!("open {}", "ab".repeat(32)), "open short".into(), "paused true".into(), "volume 0.5".into(), "close".into()])
        });
        g.assert_js(r#"if(link.pair('x')!==false||link.forget('x')!==false||link.remove('x')!==false||link.catalog()!==-1||link.install('x')!==-1||link.poll()!==undefined)throw Error('link');if(typeof net!=='undefined')throw Error('net namespace');"#);
        link::READY.with(|ready| *ready.borrow_mut() = (br#"{"v":1,"id":"hub-1","name":"Hub","features":["media"],"clock":{"utc":5,"offsetMinutes":480}}"#.to_vec(), true));
        g.assert_js(r#"const l=JSON.parse(link.status());if(l.state!=='linked'||l.companion.id!=='hub-1'||l.paired[0].name!=='Hub'||l.features[0]!=='media'||l.clock.offsetMinutes!==480)throw Error('linked');"#);
        link::READY.with(|ready| ready.borrow_mut().1 = false);
        g.assert_js(r#"const q=JSON.parse(link.status());if(q.state!=='searching'||q.companion!==null||q.paired[0].id!=='hub-1'||q.error.indexOf('stopped answering')<0)throw Error('silent');"#);
    }
}

/// Moved from PocketJS platforms/psp/io/src/link.rs.
#[test]
fn member_reads_top_level_values_only() {
    let json = br#"{"v":1,"id":"ab\"c","nested":{"id":"no"},"features":["media"],"clock":{"utc":5,"offsetMinutes":480}}"#;
    assert_eq!(link_record::member(json, "id"), Some(&br#""ab\"c""#[..]));
    assert_eq!(link_record::member(json, "features"), Some(&br#"["media"]"#[..]));
    assert_eq!(link_record::member(json, "clock"), Some(&br#"{"utc":5,"offsetMinutes":480}"#[..]));
    assert_eq!(link_record::member(json, "missing"), None);
}

/// Moved from PocketJS platforms/psp/io/src/link.rs.
#[test]
fn fnv_matches_the_companion() {
    // The fnv1a32 of Pocket Hub's USB carrier gives the same values.
    assert_eq!(link_record::fnv1a32(b""), 2166136261);
    assert_eq!(link_record::fnv1a32(b"a"), 0xe40c292c);
}

#[test]
fn hello_names_the_device_and_the_profile() {
    assert_eq!(
        link_record::hello_json("00001122\"x", "pocket-shell-psp"),
        r#"{"t":"hello","device":"00001122\"x","name":"PSP","model":"PSP","target":"pocket-shell-psp"}"#
    );
    let path = link_record::path(b"media.req");
    assert_eq!(&path[..path.iter().position(|b| *b == 0).unwrap()], b"host0:/pocket-link/media.req");
}

/// Moved from PocketJS tests/fixtures/psp-runtime. Vectors from the
/// companion's encoders (link/media-stream.ts createPal8Encoder,
/// runtime/spec/media-adpcm.ts encodeMediaAudio), and the PCM the C decoder
/// (devices/services/media_adpcm.h) gives for the block.
#[test]
fn media_wire_reads_what_the_companion_encodes() {
    let mut state = media_wire::Pal8::new();
    let mut reference = [9u8; 8];
    let first = [4, 0, 2, 0, 3, 0, 0, 0, 0, 0, 0, 248, 224, 7, 1, 7, 1, 2, 0, 1, 1, 2, 2];
    assert!(!media_wire::pal8_apply(&mut media_wire::Pal8::new(), &mut reference, &[4, 0, 2, 0, 0, 0, 0, 0, 8, 0]));
    reference = [0; 8];
    assert!(media_wire::pal8_apply(&mut state, &mut reference, &first));
    assert_eq!(reference, [0, 1, 2, 0, 1, 1, 2, 2]);
    assert_eq!(&state.clut[..12], &[0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    assert!(media_wire::pal8_apply(&mut state, &mut reference, &[4, 0, 2, 0, 0, 0, 0, 0, 5, 1, 0, 2, 0]));
    assert_eq!(reference, [0, 1, 2, 0, 1, 0, 2, 2]);
    // A run past the picture, or a size change mid-stream, stops the stream.
    assert!(!media_wire::pal8_apply(&mut state, &mut reference, &[4, 0, 2, 0, 0, 0, 0, 0, 9, 0]));
    assert!(!media_wire::pal8_apply(&mut state, &mut reference, &[2, 0, 2, 0, 0, 0, 0, 0, 4, 0]));

    let block = [0, 0, 10, 0, 72, 244, 20, 0, 119, 119, 119, 119, 103, 25, 47, 31, 12, 0, 145];
    let mut pcm = [0i16; media_wire::AUDIO_FRAMES * 2];
    assert_eq!(media_wire::decode_audio(&block, &mut pcm), 12);
    assert_eq!(
        &pcm[..24],
        &[0, -3000, 34, -2907, 110, -2708, 275, -2278, 630, -1353, 1395, 369, 1067, 1072, -425, 2138, -3624, 2720, -7741, 2896, -7188, 3056, -5679, 2620]
    );
    let mut bad = block;
    bad[3] = 1;
    assert_eq!(media_wire::decode_audio(&bad, &mut pcm), 0);

    // The picture in the 512-wide plane, its last column and row repeated.
    let mut plane = vec![7u8; media_wire::WIDTH * media_wire::HEIGHT];
    media_wire::expand(&reference, 4, 2, &mut plane);
    assert_eq!(&plane[..5], &[0, 1, 2, 0, 0]);
    assert_eq!(&plane[512..517], &[1, 0, 2, 2, 2]);
    assert_eq!(&plane[1024..1029], &[1, 0, 2, 2, 2]);
    assert_eq!(plane[1029], 7);
}

/// Moved from PocketJS tests/fixtures/psp-runtime.
#[test]
fn media_wire_checks_headers_and_packets() {
    let mut header = [0u8; media_wire::HEADER_BYTES];
    for (at, value) in [(0usize, 0x564d4b50u32), (16, 22050), (24, 1500), (28, 60_000)] {
        header[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }
    for (at, value) in [(4usize, 1u16), (6, 32), (8, 512), (10, 256), (12, 12), (14, 2), (20, 2), (22, 2)] {
        header[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }
    let parsed = media_wire::header(&header).expect("valid header");
    assert_eq!((parsed.fps, parsed.codec, parsed.origin_ms, parsed.duration_ms), (12, media_wire::CODEC_PAL8, 1500, 60_000));
    header[12] = 0;
    assert!(media_wire::header(&header).is_none());
    let packet = |kind: u8, size: u32| {
        let mut p = [0u8; media_wire::PACKET_HEADER_BYTES];
        p[0] = kind;
        p[4..8].copy_from_slice(&size.to_le_bytes());
        p[8..12].copy_from_slice(&40u32.to_le_bytes());
        p
    };
    assert_eq!(media_wire::packet(&packet(1, 100)), Some((1, 100, 40)));
    assert_eq!(media_wire::packet(&packet(2, 1031)), Some((2, 1031, 40)));
    assert_eq!(media_wire::packet(&packet(2, 1032)), None);
    assert_eq!(media_wire::packet(&packet(3, 1)), None);
    assert_eq!(media_wire::packet(&packet(5, 0)), None);
}
