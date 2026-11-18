# Licensing

Pocket Shell is distributed under GNU GPL version 3. The complete license
text is in [LICENSE](LICENSE).

| Scope | License |
| --- | --- |
| Root tooling and documentation, 3DS and touch code and original assets | GPL-3.0-or-later |
| Imported desktop shell code, documentation and original assets | GPL-3.0-only |
| M5Stack firmware in `devices/m5stack`: code, documentation and original assets | GPL-3.0-or-later |
| PocketJS runtime submodule | MIT |
| `runtime/`, `link/`, `docs/POCKET-LINK.md`, `docs/APPLETS.md` and `docs/POCKET-AGENT.md` | Imported from PocketJS (MIT) at commit `89e1043830434e07926e520d129c4fe0fccdcd48`; distributed here under GPL-3.0-or-later. The original notice is [runtime/LICENSE.pocketjs-MIT](runtime/LICENSE.pocketjs-MIT) |
| Third-party fonts and derived font atlases | Their accompanying font licenses |
| Third-party files in `devices/m5stack`: M5Stack's Tab5 demo pictures, Bosch's BMI270 feature image | Their accompanying notices (MIT, BSD-3-Clause) |

The desktop import retains the original GPL version grant. It is maintained
here under GPLv3; this repository does not offer a commercial licensing option
or require the former desktop contributor license agreement. See
[desktop third-party notices](shells/desktop/THIRD_PARTY.md).

Source history from pocket-desktop is preserved as the second parent of the
integration merge, starting from commit
`7e65502dcddcf777cbab44e4ca1c131db89a66f1`. Historical licensing and contribution
documents remain in that history; current contributions follow this file and
[CONTRIBUTING.md](CONTRIBUTING.md).

The M5Stack firmware was imported from pocket-m5, which was distributed under
the MIT license. From the import merge on, it is distributed here under
GPL-3.0-or-later. The MIT license asks that its copyright and permission
notice accompany copies of the code, so pocket-m5's notice stays in the tree
as [devices/m5stack/LICENSE.pocket-m5-MIT](devices/m5stack/LICENSE.pocket-m5-MIT);
it applies to the code as imported. The pictures in
`devices/m5stack/apps/tab5-demo/art` and the BMI270 feature image in
`devices/m5stack/apps/tab5-demo/drivers` keep the notices beside them
([art/LICENSE](devices/m5stack/apps/tab5-demo/art/LICENSE),
[BOSCH-LICENSE.txt](devices/m5stack/apps/tab5-demo/drivers/BOSCH-LICENSE.txt)).

Source history from pocket-m5 is preserved as the second parent of the import
merge: one commit that moves the tree to `devices/m5stack/`, on top of
pocket-m5 commit `db98ac45916a8ec4a2d85fa2a7e9cb09fa95bd1c`. Historical
licensing documents remain in that history.
