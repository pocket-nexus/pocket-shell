// SPDX-License-Identifier: GPL-3.0-or-later
// @title X
import X from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";
import { readScreen } from "../ui/screen.ts";

mount(() => {
  readScreen();
  return <X />;
});
