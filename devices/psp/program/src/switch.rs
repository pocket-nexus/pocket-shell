// SPDX-License-Identifier: GPL-3.0-or-later
//! App switching (spec ops 39 to 41): the app table, the pending switch
//! request, the SELECT summon and the frozen-frame capture.
//!
//! One guest is alive at a time; a switch is a whole-guest swap main.rs
//! performs after a presented frame. This module holds the state the swap
//! needs: which app boots next, the resume context of a SELECT summon, and
//! the 256×128 shot the summon captured from the display. A build without
//! registry guests has a table of one: `multi()` is false, no provider is
//! registered, and none of this runs.
//!
//! Single-threaded (the QuickJS worker); `static mut` as in pocketjs-psp.

use alloc::{boxed::Box, string::String};

use pocket_runtime::{OpArg, OpProvider, OpResult, RuntimeError};
use pocketjs_core::{spec, Ui};
use pocketjs_psp::libquickjs_sys::{JSContext, JSValue};
use pocketjs_psp::{embedded, frame, host, Runtime};

// $OUT_DIR/guests.rs — `EmbeddedGuest` + `GUESTS`, app 1 onward (build.rs).
include!(concat!(env!("OUT_DIR"), "/guests.rs"));

/// One app of the table: app 0 is the bundle the library embeds.
pub struct App {
    pub output: &'static str,
    pub id: &'static str,
    pub title: &'static str,
}

pub fn len() -> usize {
    1 + GUESTS.len()
}

/// More than one app: the summon chord and the app* ops are live.
pub fn multi() -> bool {
    len() > 1
}

pub fn app(index: usize) -> App {
    match index {
        0 => {
            // App 0's id and title come from its bundle's identity section.
            let identity = pocket_package::Bundle::parse(embedded::BUNDLE, false)
                .ok()
                .and_then(|bundle| bundle.identity().ok().flatten());
            App {
                output: embedded::OUTPUT,
                id: identity.as_ref().map_or("", |i| i.id),
                title: identity.as_ref().map_or("", |i| i.title),
            }
        }
        _ => {
            let guest = &GUESTS[index - 1];
            App { output: guest.output, id: guest.id, title: guest.title }
        }
    }
}

/// The package source of app `index`; the runtime admits its bytes as they are.
pub fn guest_source(index: usize) -> Result<Box<dyn pocket_drivers::PackageSource>, String> {
    if index == 0 {
        return embedded::source();
    }
    let guest = GUESTS.get(index - 1).ok_or_else(|| String::from("unknown app index"))?;
    Ok(Box::new(pocket_package::source::StaticMemorySource(guest.bundle)))
}

/// Shot geometry (spec op 41). The FULL 480×272 frame is downscaled — the
/// texture stores it slightly squeezed (2:1 vs 1.76:1) and consumers draw at
/// screen aspect, which undoes it exactly. No crop: a cropped shot visibly
/// deformed the veil's dimming screen and cut covers' top and bottom
/// (real-hardware find).
pub const SHOT_W: u32 = 256;
pub const SHOT_H: u32 = 128;
const SHOT_BYTES: usize = (SHOT_W * SHOT_H * 4) as usize;
const SRC_W: usize = 480;
const SRC_H: usize = 272;
/// One display row as `host::read_display_rows_rgba` writes it: 512 pixels.
const ROW_BYTES: usize = 512 * 4;

static mut CURRENT: usize = 0;
static mut PENDING: i32 = -1;
static mut PENDING_SUMMON: bool = false;
static mut RESUME: i32 = -1;
// 16-aligned: sceGuTexImage samples this buffer directly during the veil.
static mut SHOT: pocketjs_psp::psp::Align16<[u8; SHOT_BYTES]> =
    pocketjs_psp::psp::Align16([0; SHOT_BYTES]);
/// Raw pixels valid: the last summon captured them, and the veil dims them
/// on every later switch. GUEST_SHOT additionally marks the switch that is a
/// summon: only then does op 41 hand the shot to the incoming guest.
static mut SHOT_VALID: bool = false;
static mut GUEST_SHOT: bool = false;

pub unsafe fn set_current(index: usize) {
    CURRENT = index;
}

pub unsafe fn resume() -> Option<usize> {
    usize::try_from(RESUME).ok()
}

pub fn find(output: &str) -> Option<usize> {
    (0..len()).position(|index| app(index).output == output)
}

/// Guest request (spec op 40): switch after the current frame presents.
pub unsafe fn request_launch(index: usize) {
    PENDING = index as i32;
    PENDING_SUMMON = false;
}

/// Host chord: SELECT press edge in a guest other than app 0 summons app 0.
pub unsafe fn request_summon() {
    PENDING = 0;
    PENDING_SUMMON = true;
}

/// Consume the pending request: (target app, was-a-summon).
pub unsafe fn take_pending() -> Option<(usize, bool)> {
    let target = usize::try_from(PENDING).ok()?;
    let summon = PENDING_SUMMON;
    PENDING = -1;
    PENDING_SUMMON = false;
    if summon {
        RESUME = CURRENT as i32;
        GUEST_SHOT = true;
    } else {
        RESUME = -1;
        GUEST_SHOT = false;
    }
    Some((target, summon))
}

/// The veil's background: the downscaled pixels of the frame the outgoing
/// guest last presented (any switch), 256×128 RGBA.
pub unsafe fn shot_pixels() -> Option<&'static [u8]> {
    if SHOT_VALID {
        Some(&SHOT.0)
    } else {
        None
    }
}

fn push_json_str(out: &mut String, value: &str) {
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&alloc::format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// spec op 39 — the table and the switch state, one JSON string.
pub unsafe fn table_json() -> String {
    let mut out = String::from("{\"apps\":[");
    for index in 0..len() {
        let entry = app(index);
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"output\":");
        push_json_str(&mut out, entry.output);
        out.push_str(",\"id\":");
        push_json_str(&mut out, entry.id);
        out.push_str(",\"title\":");
        push_json_str(&mut out, entry.title);
        out.push('}');
    }
    out.push_str("],\"launcher\":");
    push_json_str(&mut out, app(0).output);
    out.push_str(",\"current\":");
    push_json_str(&mut out, app(CURRENT).output);
    out.push_str(",\"resume\":");
    match resume() {
        Some(index) => push_json_str(&mut out, app(index).output),
        None => out.push_str("null"),
    }
    out.push('}');
    out
}

/// Read back the frame the display shows (`Runtime::complete` first, so the
/// GE is idle) and bilinear-downscale the FULL frame into the shot buffer.
pub unsafe fn capture_shot() {
    // Two source rows bounced into cached RAM per output row.
    let mut row0 = [0u8; ROW_BYTES];
    let mut row1 = [0u8; ROW_BYTES];
    let scale_x = SRC_W as f32 / SHOT_W as f32; // 1.875
    let scale_y = SRC_H as f32 / SHOT_H as f32; // 2.125
    for dy in 0..SHOT_H as usize {
        let sy = (dy as f32 + 0.5) * scale_y - 0.5;
        let y0 = (sy as i32).clamp(0, SRC_H as i32 - 1) as usize;
        let y1 = (y0 + 1).min(SRC_H - 1);
        let fy = (sy - y0 as f32).clamp(0.0, 1.0);
        if !host::read_display_rows_rgba(y0, 1, &mut row0)
            || !host::read_display_rows_rgba(y1, 1, &mut row1)
        {
            SHOT_VALID = false;
            return;
        }
        for dx in 0..SHOT_W as usize {
            let sx = (dx as f32 + 0.5) * scale_x - 0.5;
            let x0 = (sx as i32).clamp(0, SRC_W as i32 - 1) as usize;
            let x1 = (x0 + 1).min(SRC_W - 1);
            let fx = (sx - x0 as f32).clamp(0.0, 1.0);
            let o = (dy * SHOT_W as usize + dx) * 4;
            for c in 0..3 {
                let p00 = row0[x0 * 4 + c] as f32;
                let p01 = row0[x1 * 4 + c] as f32;
                let p10 = row1[x0 * 4 + c] as f32;
                let p11 = row1[x1 * 4 + c] as f32;
                let top = p00 + (p01 - p00) * fx;
                let bot = p10 + (p11 - p10) * fx;
                SHOT.0[o + c] = (top + (bot - top) * fy + 0.5) as u8;
            }
            // The GE leaves framebuffer alpha at 0 — an as-is upload would
            // blend to nothing. The shot is opaque by definition.
            SHOT.0[o + 3] = 0xff;
        }
    }
    SHOT_VALID = true;
}

/// The app* operations, registered for each guest of a multi-app table.
struct Ops {
    /// The shot texture in this guest's core, uploaded on the first op 41.
    /// The handle dies with the guest's Ui.
    shot: Option<i32>,
}
impl OpProvider for Ops {
    fn supports_op(&self, op: u16) -> bool {
        matches!(op, 39..=41)
    }
    fn dispatch(&mut self, ui: &mut Ui, op: u16, args: &[OpArg<'_>]) -> Result<OpResult, RuntimeError> {
        unsafe {
            Ok(match op {
                39 => OpResult::Bytes(table_json().into_bytes()),
                40 => {
                    let Some(OpArg::Bytes(output)) = args.first() else {
                        return Err(RuntimeError::InvalidArgument);
                    };
                    let output = core::str::from_utf8(output).map_err(|_| RuntimeError::InvalidArgument)?;
                    OpResult::Integer(match find(output) {
                        Some(index) => {
                            request_launch(index);
                            1
                        }
                        None => 0,
                    })
                }
                41 => OpResult::Integer(i64::from(*self.shot.get_or_insert_with(|| {
                    // Bilinear: the 256×128 shot stretches back over 480×272.
                    if SHOT_VALID && GUEST_SHOT {
                        ui.upload_texture_flags(&SHOT.0, SHOT_W, SHOT_H, spec::psm::PSM_8888, spec::img::FLAG_LINEAR)
                    } else {
                        -1
                    }
                }))),
                _ => return Err(RuntimeError::UnsupportedOperation),
            })
        }
    }
}

/// One guest of the table, as the library's frame loop drives it.
pub struct Guest {
    index: usize,
    /// A guest starts latched: a SELECT still held from the press that
    /// booted it must be released before it summons.
    previous_select: bool,
}
impl Guest {
    pub fn new(index: usize) -> Self {
        Self { index, previous_select: true }
    }
}
impl frame::Program for Guest {
    /// The app to boot next.
    type Exit = usize;
    unsafe fn configure(&mut self, runtime: &mut Runtime) -> Result<(), String> {
        if multi() {
            runtime.add_provider(Box::new(Ops { shot: None }))?;
        }
        Ok(())
    }
    /// Every guest gets the companion's link and media namespaces.
    unsafe fn globals(&mut self, context: *mut JSContext, global: JSValue) {
        crate::bindings::install(context, global);
    }
    /// The media plane's latest due picture, committed into this frame.
    unsafe fn commit(&mut self, ui: &mut Ui) {
        crate::media::present(ui);
    }
    /// SELECT is a host-owned summon chord in guests other than app 0: they
    /// never see it, and its press edge schedules the summon.
    fn buttons(&mut self, buttons: u32) -> u32 {
        if !multi() || self.index == 0 {
            return buttons;
        }
        let select = buttons & spec::btn::SELECT != 0;
        if select && !self.previous_select {
            unsafe { request_summon() };
        }
        self.previous_select = select;
        buttons & !spec::btn::SELECT
    }
    /// A request becomes a switch after the frame that made it presents. A
    /// summon reads that frame back for the shot.
    unsafe fn end_frame(&mut self, runtime: &mut Runtime) -> Option<usize> {
        let (next, summon) = take_pending()?;
        if let Err(error) = runtime.complete() {
            frame::trace(&error);
        }
        if summon {
            capture_shot();
        }
        Some(next)
    }
}
