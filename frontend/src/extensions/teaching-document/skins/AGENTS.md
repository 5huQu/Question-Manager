# Teaching Document Skin Extensions

This directory is the source-level discovery root for Teaching Document skins.

Allowed work for a normal skin task is limited to `extensions/teaching-document/skins/**`: add a directory containing `skin.ts`, optional `styles.css`, and local assets that are safe for bundling. A `skin.ts` file must default-export `defineHeadingSkin(...)` or `defineBoxSkin(...)` and may import its sibling CSS.

Do not modify pagination, TeachingDocument core schema (unless the skin API itself is explicitly being upgraded), ProseMirror core, server routes, database code, or the print pipeline for a normal skin request. Do not add executable runtime renderers, user supplied JavaScript, or CSS/HTML to TeachingDocument JSON.

If the API cannot express the requested visual safely, report the contract limitation before changing core infrastructure.
