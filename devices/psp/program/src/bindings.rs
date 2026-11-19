// SPDX-License-Identifier: GPL-3.0-or-later
//! `globalThis.link` (runtime/spec/link.ts LinkOps) and `globalThis.media`
//! (runtime/spec/media.ts MediaOps), both carried by the companion on the USB
//! share (link.rs, media.rs). The program installs them for every guest from
//! `frame::Program::globals`: after the generated bindings created `ui` and
//! the library mounted its namespaces, before the bundle evaluates.
use pocketjs_psp::libquickjs_sys::*;
use pocketjs_psp::service_bindings::{add_fn, arg_bytes, arg_f64};

extern "C" {
    fn JS_NewStringLen(ctx: *mut JSContext, text: *const u8, length: usize) -> JSValue;
    fn JS_ToBool(ctx: *mut JSContext, value: JSValue) -> i32;
}

// ---- globalThis.link over the USB share (link.rs) ---------------------------

/// link.status() -> LinkStatus JSON (the Pocket Link contract's shape).
unsafe extern "C" fn js_link_status(
    ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    let s = crate::link::link_status();
    JS_NewStringLen(ctx, s.as_ptr(), s.len())
}

/// link.pair / forget / remove: the USB carrier has no pairing and no
/// installs (the cable is the trust boundary), so each refuses.
unsafe extern "C" fn js_link_refuse(
    ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    JS_NewBool(ctx, false)
}

/// link.catalog / install -> -1: not carried over USB.
unsafe extern "C" fn js_link_no_request(
    ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    JS_NewInt32(ctx, -1)
}

/// link.poll() -> no link events over USB.
unsafe extern "C" fn js_link_poll(
    _ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    JS_UNDEFINED
}

// ---- globalThis.media over the USB share's media ring (media.rs) ---------------

/// media.open(host, port, token) -> bool (runtime/spec/media.ts MediaOps).
unsafe extern "C" fn js_media_open(
    ctx: *mut JSContext,
    _this: JSValue,
    argc: i32,
    argv: *mut JSValue,
) -> JSValue {
    let Some((pointer, token)) = arg_bytes(ctx, argc, argv, 2) else {
        return JS_NewBool(ctx, false);
    };
    let ok = crate::media::open(token);
    JS_FreeCString(ctx, pointer);
    JS_NewBool(ctx, ok)
}

unsafe extern "C" fn js_media_close(
    _ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    crate::media::close();
    JS_UNDEFINED
}

unsafe extern "C" fn js_media_paused(
    ctx: *mut JSContext,
    _this: JSValue,
    argc: i32,
    argv: *mut JSValue,
) -> JSValue {
    crate::media::set_paused(argc >= 1 && JS_ToBool(ctx, *argv) > 0);
    JS_UNDEFINED
}

unsafe extern "C" fn js_media_volume(
    ctx: *mut JSContext,
    _this: JSValue,
    argc: i32,
    argv: *mut JSValue,
) -> JSValue {
    crate::media::set_volume(arg_f64(ctx, argc, argv, 0) as f32);
    JS_UNDEFINED
}

/// media.texture(): the plane, uploaded into the calling guest's Ui.
unsafe extern "C" fn js_media_texture(
    ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    JS_NewInt32(ctx, pocketjs_psp::with_ui(ctx, |ui| crate::media::texture(ui)).unwrap_or(-1))
}

unsafe extern "C" fn js_media_status(
    ctx: *mut JSContext,
    _this: JSValue,
    _argc: i32,
    _argv: *mut JSValue,
) -> JSValue {
    let s = crate::media::status();
    JS_NewStringLen(ctx, s.as_ptr(), s.len())
}

/// Install `globalThis.link` and `globalThis.media`. The link starts here
/// on the first guest, before it evaluates, so a status read or a media
/// stream opened at mount finds a companion that answers.
///
/// # Safety
/// QuickJS context alive, worker thread.
pub unsafe fn install(ctx: *mut JSContext, global: JSValue) {
    crate::link::start(pocketjs_psp::profile::ID);
    let link = JS_NewObject(ctx);
    add_fn(ctx, link, b"status\0", js_link_status, 0);
    add_fn(ctx, link, b"pair\0", js_link_refuse, 1);
    add_fn(ctx, link, b"forget\0", js_link_refuse, 1);
    add_fn(ctx, link, b"remove\0", js_link_refuse, 1);
    add_fn(ctx, link, b"catalog\0", js_link_no_request, 0);
    add_fn(ctx, link, b"install\0", js_link_no_request, 1);
    add_fn(ctx, link, b"poll\0", js_link_poll, 0);
    JS_SetPropertyStr(ctx, global, b"link\0".as_ptr() as *const _, link);
    let media = JS_NewObject(ctx);
    add_fn(ctx, media, b"open\0", js_media_open, 3);
    add_fn(ctx, media, b"close\0", js_media_close, 0);
    add_fn(ctx, media, b"paused\0", js_media_paused, 1);
    add_fn(ctx, media, b"volume\0", js_media_volume, 1);
    add_fn(ctx, media, b"texture\0", js_media_texture, 0);
    add_fn(ctx, media, b"status\0", js_media_status, 0);
    JS_SetPropertyStr(ctx, global, b"media\0".as_ptr() as *const _, media);
}
