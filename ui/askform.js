// SPDX-License-Identifier: Apache-2.0
// A Claude Code question dialog with several questions or multi-select (1.0.1), shared by the Attention card and the
// conversation view: one block per question with its header, radio buttons (single choice) or checkboxes
// (multi-select), "Recommended" marks, an "Other" text field each, and one "Send answers". The server drives the
// dialog with keys from these answers ({ choices: [option numbers], text } per question).
import { esc } from './lib.js';
import { t } from './i18n.js';

// several questions, or a multi-select: the plain option buttons cannot answer it
export const isAsk = (item) => !!item?.questions?.length && (item.questions.length > 1 || item.questions.some((q) => q.multiSelect));
const clean = (label) => String(label).replace(/\s*\(recommended\)\s*/i, ' ').trim();

export function askFormHtml(item, { act = 'answer-ask' } = {}) {
  const blocks = item.questions.map((q, i) => `<fieldset class="askQ"><legend>${q.header ? `<b>${esc(q.header)}</b> · ` : ''}${q.multiSelect ? t('choose any') : t('choose one')}</legend>
    <div class="askText">${esc(q.question)}</div>
    ${q.options.map((o) => `<label class="inline askOpt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${i}" value="${o.n}"> ${esc(clean(o.label))}${o.recommended ? ` <span class="chip ok">${t('Recommended')}</span>` : ''}</label>`).join('')}
    <input name="q${i}text" class="askOther" placeholder="${t('Other (your own answer)')}" aria-label="${t('Other answer for {header}', { header: esc(q.header || q.question) })}"></fieldset>`).join('');
  return `<form class="askForm" data-act="${act}" data-id="${esc(item.id)}">${blocks}<div class="row"><span class="err grow" data-askerr></span><button class="gold">${t('Send answers')}</button></div></form>`;
}

// -> [{ choices, text }] or throws with what is missing
export function readAskForm(form, item) {
  return item.questions.map((q, i) => {
    const choices = [...form.querySelectorAll(`[name="q${i}"]:checked`)].map((x) => +x.value);
    const text = form.elements[`q${i}text`].value.trim();
    if (!choices.length && !text) throw new Error(t('Answer question {n} ({header})', { n: i + 1, header: q.header || q.question.slice(0, 40) }));
    if (!q.multiSelect && choices.length && text) throw new Error(t('Question {n}: pick an option or write your own, not both', { n: i + 1 }));
    return { choices, text };
  });
}
