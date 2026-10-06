# Licenses & Acknowledgements

Whiteboard is a desktop shell around the **official Excalidraw editor**.
Whiteboard's own code is MIT-licensed (see [`../LICENSE`](../LICENSE)) and is
separate from Excalidraw; Excalidraw is used unmodified
via the `@excalidraw/excalidraw` npm package (v0.18.1). "Excalidraw" is the name
of the upstream project; Whiteboard is not affiliated with or endorsed by it and
does not use the Excalidraw logo as its identity.

## Excalidraw (editor)

- Package: `@excalidraw/excalidraw` 0.18.1 — https://github.com/excalidraw/excalidraw
- License: MIT — Copyright (c) 2020 Excalidraw. Full text: `Excalidraw-MIT.txt`.
- Excalidraw's UI icons ship inside the package and are covered by the same MIT license.

## Fonts bundled from the Excalidraw package (`public/fonts`)

Fonts are copied unmodified from `@excalidraw/excalidraw/dist/prod/fonts`.

| Font | Copyright | License |
| --- | --- | --- |
| Excalifont | © 2024 Excalidraw | SIL OFL 1.1 (https://plus.excalidraw.com/excalifont) |
| Virgil | © 2021–present Ellinor Rapp, Reserved Font Name "Virgil" | SIL OFL 1.1 (https://github.com/excalidraw/virgil) |
| Cascadia Code | © 2019–present Microsoft Corporation, Reserved Font Name "Cascadia Code" | SIL OFL 1.1 (https://github.com/microsoft/cascadia-code) |
| Liberation Sans | Digitized data © 2010 Google Corporation; © 2012 Red Hat, Inc., Reserved Font Name "Liberation" | SIL OFL 1.1 (https://github.com/liberationfonts/liberation-fonts) |
| Lilita One | © 2011 Juan Montoreano, Reserved Font Name "Lilita" | SIL OFL 1.1 (Google Fonts) |
| Nunito | © 2014 The Nunito Project Authors | SIL OFL 1.1 (https://github.com/googlefonts/nunito) |
| Assistant | © 2020 The Assistant Project Authors; © 2010 The Source Sans Pro Authors, Reserved Font Name "Source" | SIL OFL 1.1 (https://github.com/hafontia/Assistant) |
| Xiaolai | © 2020 LXGW | SIL OFL 1.1 (https://github.com/lxgw/kose-font) |
| Comic Shanns | © 2018 Shannon Miwa and contributors | MIT (`ComicShanns-MIT.txt`) |

The SIL Open Font License 1.1 text is in `OFL-1.1.txt`. Under the OFL the fonts
may be bundled and redistributed with software; they may not be sold on their
own, and modified versions may not use the Reserved Font Names.

## Other components

| Component | License |
| --- | --- |
| Tauri 2 and plugins (dialog, opener, window-state) | MIT or Apache-2.0 |
| React, React DOM | MIT |
| zustand | MIT |
| Rust crates (serde, serde_json, base64) | MIT or Apache-2.0 |

Excalidraw's own npm dependencies (roughjs, perfect-freehand, jotai, etc.) are
bundled as part of the Excalidraw package under their respective permissive
licenses (MIT / ISC / BSD).

## Whiteboard app icon

The Whiteboard icon (`assets/app-icon.svg`) is original artwork for this app and
does not use Excalidraw's logo or trademarks.
