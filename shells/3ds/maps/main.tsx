// SPDX-License-Identifier: GPL-3.0-or-later
// @title Maps
import Maps from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";
import { readScreen } from "../ui/screen.ts";

mount(() => {
  readScreen();
  return <Maps />;
});
