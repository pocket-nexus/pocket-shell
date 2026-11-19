// SPDX-License-Identifier: GPL-3.0-or-later
//! One canonical runtime archive plus the 3DS package inspection ABI and the
//! native program (`pocket_native_program.h`) built without outputs.
//! The host composes its C guest, PICA Renderer, Displays and input drivers
//! through the QuickJS facade.
#![no_std]
extern crate alloc;
pub use pocket_archive::*;
// The archive member supplies the pocket_native_program_* symbols; nothing
// here calls it by name.
use pocket_native_program as _;
use core::ffi::c_void;
use pocket_drivers::abi;
use pocket_package::sha256::sha256;
use pocket_runtime::abi::{open_c_source, OpenedPackage};

/// Borrowed sections of one admitted program. The C runtime owns the
/// `.pocket` allocation its package source returns and keeps it alive until
/// the guest is torn down.
#[repr(C)]
pub struct PocketGuestPackage {
    pub javascript: *const u8,
    pub javascript_length: usize,
    pub worker_javascript: *const u8,
    pub worker_javascript_length: usize,
    pub pak: *const u8,
    pub pak_length: usize,
    pub plan: *const u8,
    pub plan_length: usize,
    /// The `.pocket` footer and the admitted variant's payload hash: the C
    /// runtime fills both from its container reader
    /// (devices/services/pocket_container.c); this inspection leaves them 0.
    pub package_hash: u64,
    pub variant_hash: u64,
    /// What the runtime takes from the variant's plan at boot instead of
    /// having it compiled in: the primary and auxiliary surfaces (auxiliary
    /// width and height are 0 when the plan has none) and
    /// POCKET_GUEST_FEATURE_* bits.
    pub view_width: u32,
    pub view_height: u32,
    pub raster_density: u32,
    pub aux_width: u32,
    pub aux_height: u32,
    pub aux_raster_density: u32,
    pub features: u32,
    /// The application's state directory name below runtime/apps: the first
    /// 16 hex digits of SHA-256(app id), NUL-terminated (devices/3ds/build.ts
    /// `runtimeSlot`).
    pub slot: [u8; 17],
}

/// `features.io.offload` is true in the plan.
pub const POCKET_GUEST_FEATURE_OFFLOAD: u32 = 1;
/// `features.media.playback` is true in the plan.
pub const POCKET_GUEST_FEATURE_MEDIA: u32 = 2;
/// `features.system.agent` is true in the plan: the top screen is the agent stage.
pub const POCKET_GUEST_FEATURE_AGENT: u32 = 4;
/// `features.system.extension` is true in the plan: a product extension owns the top screen.
pub const POCKET_GUEST_FEATURE_EXTENSION: u32 = 64;
/// `features.data.fs` is true in the plan: the guest gets `globalThis.fs`.
pub const POCKET_GUEST_FEATURE_FS: u32 = 8;
/// `features.camera.qr` is true in the plan: the outer camera's viewfinder
/// with QR decoding.
pub const POCKET_GUEST_FEATURE_CAMERA_QR: u32 = 16;
/// `features.camera.photo` is true in the plan: both cameras, capture and
/// the photo store.
pub const POCKET_GUEST_FEATURE_CAMERA_PHOTO: u32 = 32;
/// `features.link.channel` is true in the plan: the guest gets
/// `globalThis.channel`, its applet channel to its daemon over the Pocket Link.
pub const POCKET_GUEST_FEATURE_CHANNEL: u32 = 128;

/// Admit the program a package source states (`pocket_package_source_v1`
/// with a `sections` callback: the C runtime's `.pocket` reader) by the path
/// boot takes, `pocket_runtime::abi::open_c_source`, which
/// `pocket_native_package_open_source` also takes, and read the facts the
/// 3DS boots by from its plan. Returns the generated `POCKET_PACKAGE_OPEN_*`
/// codes of `pocket_runtime.h`, which the C runtime's status and recovery
/// files store: `OK` on success, an admission code, `BAD_ARGUMENT` for a bad
/// pointer, `SOURCE` for a source that does not supply its length, sections
/// or bytes, `NO_IDENTITY` for a plan without an app id, `PLAN_JSON`,
/// `PLAN_VIEWPORT` or `PLAN_AUXILIARY` for a plan whose JSON, viewport or
/// auxiliary surface cannot be read, and `BAD_ARGUMENT` when the source has
/// no `all` callback, whose bytes the record borrows. The source is not
/// taken: the same source boots the program.
///
/// # Safety
/// `source` and `context` obey the C package source contract; `facts` and
/// `profile_hash` are the program's exported profile facts and hash; `out`
/// is writable.
#[no_mangle]
pub unsafe extern "C" fn pocket_package_open_source(
    source: *const abi::PocketPackageSourceV1,
    context: *mut c_void,
    facts: *const abi::PocketProfileFacts,
    host_abi: u32,
    profile_hash: *const u8,
    out: *mut PocketGuestPackage,
) -> i32 {
    if out.is_null() {
        return abi::POCKET_PACKAGE_OPEN_BAD_ARGUMENT;
    }
    // The app id names the state slot below runtime/apps.
    let record = unsafe {
        open_c_source(source, context, facts, host_abi, profile_hash, true, |opened, borrowed| {
            borrowed.then(|| record(opened))
        })
    };
    match record {
        Ok(Some(record)) => {
            unsafe { out.write(record) };
            abi::POCKET_PACKAGE_OPEN_OK
        }
        Ok(None) => abi::POCKET_PACKAGE_OPEN_BAD_ARGUMENT,
        Err(code) => code,
    }
}

/// The state slot of an app id below runtime/apps: the first 16 lowercase
/// hex digits of SHA-256 of the id, NUL-terminated (devices/services
/// sha256_slot makes the same).
fn slot(id: &str) -> [u8; 17] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = sha256(id.as_bytes());
    let mut slot = [0u8; 17];
    for (index, byte) in digest[..8].iter().enumerate() {
        slot[index * 2] = HEX[usize::from(byte >> 4)];
        slot[index * 2 + 1] = HEX[usize::from(byte & 15)];
    }
    slot
}

fn record(opened: &OpenedPackage<'_>) -> PocketGuestPackage {
    let (guest, facts) = (&opened.guest, &opened.facts);
    let auxiliary = facts.auxiliary;
    let slot = slot(guest.id);
    let feature = |name: &str, bit: u32| if facts.feature(name) { bit } else { 0 };
    PocketGuestPackage {
        javascript: guest.js.as_ptr(),
        javascript_length: guest.js.len(),
        worker_javascript: guest.worker_js.as_ptr(),
        worker_javascript_length: guest.worker_js.len(),
        pak: guest.pak.as_ptr(),
        pak_length: guest.pak.len(),
        plan: guest.plan.as_ptr(),
        plan_length: guest.plan.len(),
        package_hash: 0,
        variant_hash: 0,
        view_width: facts.viewport.width,
        view_height: facts.viewport.height,
        raster_density: facts.viewport.raster_density,
        aux_width: auxiliary.map_or(0, |surface| surface.width),
        aux_height: auxiliary.map_or(0, |surface| surface.height),
        aux_raster_density: auxiliary.map_or(0, |surface| surface.raster_density),
        features: feature("io.offload", POCKET_GUEST_FEATURE_OFFLOAD)
            | feature("media.playback", POCKET_GUEST_FEATURE_MEDIA)
            | feature("system.agent", POCKET_GUEST_FEATURE_AGENT)
            | feature("system.extension", POCKET_GUEST_FEATURE_EXTENSION)
            | feature("data.fs", POCKET_GUEST_FEATURE_FS)
            | feature("camera.qr", POCKET_GUEST_FEATURE_CAMERA_QR)
            | feature("camera.photo", POCKET_GUEST_FEATURE_CAMERA_PHOTO)
            | feature("link.channel", POCKET_GUEST_FEATURE_CHANNEL),
        slot,
    }
}
