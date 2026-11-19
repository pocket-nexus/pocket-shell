// SPDX-License-Identifier: GPL-3.0-or-later
//! The USB carrier's records (runtime/spec/link.ts "USB carrier"): the record
//! header words, FNV-1a 32, the share paths, the JSON reads and the LinkStatus
//! the console reports. No device calls, so the host test (../host-test) runs
//! these.

use alloc::string::String;

pub const MAGIC: u32 = 0x554c4b50;
pub const HEADER: usize = 64;
pub const KIND_READY: u32 = 1;
pub const KIND_HELLO: u32 = 2;
pub const KIND_MEDIA: u32 = 3;
/// The companion's `ready` JSON, at most.
pub const STATUS_MAX: usize = 1024;

pub fn fnv1a32(bytes: &[u8]) -> u32 {
    bytes
        .iter()
        .fold(2166136261u32, |h, b| (h ^ *b as u32).wrapping_mul(16777619))
}

pub fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

pub fn put(b: &mut [u8], at: usize, value: u32) {
    b[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

/// `s` as a JSON string literal, appended to `out`.
pub fn push_json_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let hex = b"0123456789abcdef";
                out.push_str("\\u00");
                out.push(hex[(c as u32 >> 4) as usize] as char);
                out.push(hex[(c as u32 & 0xf) as usize] as char);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// The raw value of a top-level member of a JSON object (`{…}`), or None.
/// Enough JSON for records this module and the companion write.
pub fn member<'a>(object: &'a [u8], key: &str) -> Option<&'a [u8]> {
    let mut i = object.iter().position(|b| *b == b'{')? + 1;
    loop {
        while i < object.len() && matches!(object[i], b' ' | b'\n' | b'\r' | b'\t' | b',') {
            i += 1;
        }
        if i >= object.len() || object[i] != b'"' {
            return None;
        }
        let name_end = skip_value(object, i)?;
        let name = &object[i + 1..name_end - 1];
        i = name_end;
        while i < object.len() && matches!(object[i], b' ' | b'\n' | b'\r' | b'\t' | b':') {
            i += 1;
        }
        let end = skip_value(object, i)?;
        if name == key.as_bytes() {
            return Some(&object[i..end]);
        }
        i = end;
    }
}

/// The index past the JSON value starting at `i`.
fn skip_value(s: &[u8], mut i: usize) -> Option<usize> {
    match *s.get(i)? {
        b'"' => {
            i += 1;
            while i < s.len() {
                match s[i] {
                    b'\\' => i += 2,
                    b'"' => return Some(i + 1),
                    _ => i += 1,
                }
            }
            None
        }
        b'{' | b'[' => {
            let mut depth = 0usize;
            while i < s.len() {
                match s[i] {
                    b'"' => {
                        i = skip_value(s, i)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(i + 1);
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            None
        }
        _ => {
            while i < s.len() && !matches!(s[i], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t') {
                i += 1;
            }
            Some(i)
        }
    }
}

/// `host0:/pocket-link/<name>`, NUL-terminated.
pub fn path(name: &[u8]) -> [u8; 48] {
    let mut out = [0u8; 48];
    let prefix = b"host0:/pocket-link/";
    out[..prefix.len()].copy_from_slice(prefix);
    out[prefix.len()..prefix.len() + name.len()].copy_from_slice(name);
    out
}

/// The `hello` record's JSON for device `device` built for profile `target`.
pub fn hello_json(device: &str, target: &str) -> String {
    let mut hello = String::from("{\"t\":\"hello\",\"device\":");
    push_json_str(&mut hello, device);
    hello.push_str(",\"name\":\"PSP\",\"model\":\"PSP\",\"target\":");
    push_json_str(&mut hello, target);
    hello.push('}');
    hello
}

/// spec link op status(): the LinkStatus JSON for the companion's last
/// `ready` JSON (`ready`, empty before any) and whether it beats (`linked`).
pub fn status_json(ready: &[u8], linked: bool, device: &str) -> String {
    let linked = linked && !ready.is_empty();
    let text = |value: Option<&[u8]>, fallback: &'static str| -> String {
        String::from(value.and_then(|v| core::str::from_utf8(v).ok()).unwrap_or(fallback))
    };
    let mut out = String::from("{\"state\":");
    out.push_str(if linked { "\"linked\"" } else { "\"searching\"" });
    let companion = if !ready.is_empty() {
        let mut c = String::from("{\"id\":");
        c.push_str(&text(member(ready, "id"), "\"\""));
        c.push_str(",\"name\":");
        c.push_str(&text(member(ready, "name"), "\"\""));
        c.push_str(",\"address\":\"usb\",\"port\":0}");
        Some(c)
    } else {
        None
    };
    out.push_str(",\"companion\":");
    match &companion {
        Some(c) if linked => out.push_str(c),
        _ => out.push_str("null"),
    }
    out.push_str(",\"paired\":[");
    if let Some(c) = &companion {
        out.push_str(c);
    }
    out.push_str("],\"device\":{\"id\":");
    push_json_str(&mut out, device);
    out.push_str(",\"name\":\"PSP\",\"model\":\"PSP\",\"address\":\"usb\"},\"pairing\":\"idle\",\"error\":");
    out.push_str(if linked || ready.is_empty() { "\"\"" } else { "\"the companion on the USB share stopped answering\"" });
    out.push_str(",\"features\":");
    out.push_str(&if linked { text(member(ready, "features"), "[]") } else { String::from("[]") });
    out.push_str(",\"clock\":");
    out.push_str(&if !ready.is_empty() { text(member(ready, "clock"), "null") } else { String::from("null") });
    out.push('}');
    out
}
