import { pageById } from "./nav.js";
import { renderPage } from "./pages.js";
import { shellDocument, sourceNote } from "./shell.js";
import { isBlank, materializeStatus } from "./model.js";

export function renderDocument(ctx) {
  const page = pageById(ctx.pageId);
  const status = materializeStatus(ctx.status, ctx.now);
  const blank = ctx.blank ?? isBlank(ctx.config);
  const content = renderPage({ ...ctx, page, status, blank });
  const note = sourceNote({
    demo: ctx.demo,
    blank,
    now: ctx.now,
    timeZone: ctx.config.board?.timezone,
  });
  return shellDocument({
    page,
    config: ctx.config,
    theme: ctx.theme,
    content,
    sourceNote: note,
    boot: ctx.bootJson,
    now: ctx.now,
  });
}
