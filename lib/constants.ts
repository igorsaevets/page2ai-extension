// Page2AI default configuration and shared constants.
// Values ported verbatim from Rev-032v2 prototype (Sections 3, 5, 16, 22).

import type { ExtractorConfig } from './types';

// Indent constant: 3 spaces for CommonMark-compatible nested lists.
export const INDENT = '   ';

export const DEFAULTS: ExtractorConfig = {
  fileExtension: 'md',
  interactionMode: 'safe-tabs-and-details',
  lazyLoadMode: 'safe',
  spaReadinessMode: 'auto',
  spaMinContentChars: 200,
  spaPollIntervalMs: 150,
  // 6 s is the point where a user assumes the extension is broken. Chosen as a
  // UX bound, not a network one: a page that has not rendered by then is better
  // reported honestly than waited on silently.
  spaMaxWaitMs: 6000,
  spaStableSamples: 2,
  lazyScrollSteps: 8,
  lazySafeViewports: 3,
  lazyScrollWaitMs: 200,
  lazyScrollExtraIdleMs: 250,
  restoreScrollAfterExport: true,
  tabPanelStrategy: 'balanced',
  visualMarkersMode: 'important-only',
  minLargeFontPx: 22,
  minBoldWeight: 600,
  outputMode: 'clean',
  extractJsonLd: false,
  extractOpenGraph: false,
  extractMicrodata: false,
  structuredDataPosition: 'before-content',
  extractInternalState: false,
  internalStateMaskingEnabled: true,
  traverseShadowDom: true,
  extractIframeSources: true,
  emitImageSrcsetCandidatesComment: false,
  typeLinkedImages: false,
  includeHiddenMeaningfulText: false,
  maxTextNodeLength: 5000,
  includeVisibleAriaHiddenText: true,
  minAriaHiddenTextLength: 1,
  longAriaHiddenThreshold: 30,
  preserveCodeWhitespace: true,
  includePseudoBeforeText: true,
  includePseudoAfterText: false,
  extractTabs: true,
  tabClickWaitMs: 700,
  tabSettleMs: 250,
  maxTabGroups: 30,
  maxButtonsPerTabGroup: 16,
  minTabButtonTextLength: 1,
  maxTabButtonTextLength: 100,
  maxTabPanelChars: 25000,
  skipCapturedTabPanelsInMainRender: true,
  abortTabCaptureOnUrlDrift: true,
  tabFallbackMaxBodyRatio: 0.5,
  perTabHardTimeoutMs: 5000,
  tabPhaseBudgetMs: 60000,
  dropdownClickWaitMs: 700,
  dropdownSettleMs: 120,
  maxDropdownButtons: 40,
  maxDropdownPanelChars: 12000,
  skipCapturedDropdownPanelsInMainRender: true,
  restoreDetailsAfterExport: true,
  enableFailSafeDownload: true,
  qualityCheckEnabled: true,
  minMainRenderToBodyRatio: 0.30,
  maxMainRenderToBodyRatio: 2.50,
  dedupeConsecutiveDuplicates: true,
  minConsecutiveDuplicatesToCollapse: 3,
  collapseShortAdjacentLines: false,
  shortLineCollapseMaxChars: 50,
  cleanupPunctuation: true,
  dedupeAdjacentLinks: true,
  aggressiveCleanup: false,
  aggressiveCleanupMaxLinkTextLength: 500,
  aggressiveCleanupHtmlTagPattern: /<(img|svg|picture|noscript|iframe|object|embed|video|audio)\b/i,
  stripNoisyAttributesInLinkText: false,
  filterDecorativeImages: false,
  decorativeImageFilenamePatterns: [
    /\bspacer\b/i, /\bblank\b/i, /\btransparent\b/i, /\bpixel\b/i,
    /\bplaceholder\b/i, /\bdivider\b/i, /\b1px\b/i, /\bdot\b/i,
    /\bshim\b/i, /\bclear\b/i,
  ],
  filterDecorativeAlt: false,
  decorativeAltPattern: /^(иконка|icon|logo|figure|picture|логотип|значок|image)\b/i,
  decorativeAltMaxWords: 3,
  suppressRepeatedImages: false,
  suppressRepeatedImageThreshold: 3,
  filterWordPressNoiseLinks: false,
  wordpressNoiseLinkPatterns: [
    /^#$/,
    /^javascript:/i,
    /#wp-toolbar\b/i,
    /#wpadminbar\b/i,
    /#search-header\b/i,
    /#respond\b/i,
    /#comments\b/i,
  ],
  compactLinkLabels: false,
  maxLinkLabelChars: 80,
  maxHiddenFormValueLength: 60,
  maskFormFieldNamePatterns: [
    /nonce/i, /csrf/i, /xsrf/i, /turnstile/i, /captcha/i, /recaptcha/i,
    /authenticity[_-]?token/i, /^_token$/i, /requestverificationtoken/i, /antiforgery/i,
  ],
  emitAppendix: true,
  emitNoscriptFallback: true,
  noscriptOnlyIfMainRenderShort: true,
  detectBadges: true,
  maxBadgeTextLength: 30,
  badgeClassPattern: /\b(badge|tag|chip|pill|label)\b/i,
  unsafeTabButtonTextPatterns: [
    /submit/i, /send/i, /subscribe/i, /unsubscribe/i, /sign\s*up/i, /sign\s*in/i,
    /log\s*in/i, /login/i, /sign\s*out/i, /logout/i, /try\s*now/i, /get\s*started/i,
    /contact/i, /book\s*(a\s*)?demo/i, /buy/i, /purchase/i, /\border\b/i,
    /checkout/i, /pay/i, /delete/i, /remove/i, /accept/i, /reject/i, /confirm/i,
    /cancel/i, /\bsave\b/i, /update/i, /cookie/i, /open\s*menu/i, /close/i,
    /удали/i, /удалить/i, /удалит/i, /оплат/i, /купи/i, /купить/i, /заказ/i,
    /заказать/i, /подпис/i, /отписат/i, /войти/i, /выйти/i,
    // JS \b is ASCII-only: /\bлогин\b/ never matched a Cyrillic label.
    /(?<![\p{L}\p{N}])логин(?![\p{L}\p{N}])/iu,
    /регистрац/i, /зарегистр/i, /отправ/i, /отмен/i, /подтвер/i, /сохран/i,
    /закрыть/i, /добавить/i, /создать/i, /начать/i, /продолжит/i, /приня/i,
    /отклон/i, /контакт/i,
    /прыняць/i, /выдалі/i, /закрыц/i, /купіц/i, /заплац/i, /адправ/i,
    /надісла/i, /видали/i, /зареєстру/i, /закри/i, /сплат/i, /придба/i,
    // BL-19 D5: action labels in 13 more languages, a second line behind the structural refusals. Each word is
    // a translation read 2026-10-16 in WordPress core (translate.wordpress.org wp/dev export: Delete, Remove,
    // Submit, Cancel, Save, Log In, Log Out) or Ant Design components/locale/*.ts (cancelText, okText, remove).
    // Latin scripts: a whole word anywhere in the label. Vietnamese, CJK and Arabic: the WHOLE label only,
    // because there the word also opens ordinary titles (VI «Lưu ý» is "Note", ZH «登录日志» a login log).
    // Left out: ES «Registro», ID «Daftar», FR «Inscription», AR «تسجيل» alone (also record, list, recording).
    /(?<![\p{L}\p{N}])(?:borrar|eliminar|enviar|cancelar|guardar|acceder|salir|aceptar)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:excluir|remover|salvar|acessar|cadastre-se|sair)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:supprimer|retirer|envoyer|annuler|enregistrer|se connecter|se déconnecter)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:löschen|entfernen|absenden|abbrechen|speichern|anmelden|registrieren|abmelden)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:elimina|rimuovi|invia|annulla|salva|accedi|registrati|esci)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:usuń|wyślij|anuluj|zapisz|zaloguj się|zarejestruj się|wyloguj się)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:sil|kaldır|gönder|vazgeç|iptal|İptal|kaydet|oturum aç|hesap aç|çıkış yap|tamam)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:hapus|singkirkan|kirim|batal|simpan|log masuk|log keluar)(?![\p{L}\p{N}])/iu,
    /^(?:xóa|xóa bỏ|gửi|hủy|lưu|lưu thay đổi|đăng nhập|đăng ký|đăng xuất|đồng ý|gỡ bỏ)$/iu,
    /^(?:删除|移除|提交|取消|保存|登录|注册|注销|确定|削除|送信|キャンセル|ログイン|登録|ログアウト)$/u,
    /^(?:삭제|제거|제출|취소|저장|로그인|회원가입|로그아웃|확인)$/u,
    /^(?:حذف|إزالة|إرسال|إلغاء|حفظ|دخول|تسجيل الخروج|تأكيد)$/u,
    /^ok$/i,
  ],
  skipSelectors: [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas',
    'object', 'embed', '[data-ai-exporter-skip="true"]',
  ],
};

export const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG',
  'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL',
  'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
  'THEAD', 'TR', 'UL',
]);

export const INLINE_FORMATTING_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA',
  'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL',
  'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

export const SOCIAL_DOMAIN_RE =
  /^https?:\/\/(?:www\.|m\.)?([a-z0-9.-]*?(?:t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|whatsapp\.com|vk\.com|facebook\.com|fb\.com|instagram\.com|youtube\.com|youtu\.be|linkedin\.com|twitter\.com|x\.com|tiktok\.com|threads\.net|max\.ru|ok\.ru|pinterest\.[a-z.]+|reddit\.com|github\.com|discord\.gg|discord\.com|slideshare\.net))/i;

export const PII_KEY_PATTERNS = [
  /^(?:.*_)?(?:token|tokens)$/i, /^(?:.*_)?password$/i, /^(?:.*_)?secret$/i,
  /^(?:.*_)?api[_-]?key$/i, /^(?:.*_)?session$/i, /^(?:.*_)?authorization$/i,
  /^(?:.*_)?cookie$/i, /^(?:.*_)?jwt$/i, /^(?:.*_)?refresh[_-]?token$/i,
  /^(?:.*_)?access[_-]?token$/i, /^(?:.*_)?email$/i, /^(?:.*_)?phone$/i,
  /^(?:.*_)?credit[_-]?card$/i, /^(?:.*_)?ssn$/i,
];

export const PII_VALUE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}\b/gi },
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'pk-key', re: /\bpk_[A-Za-z0-9_-]{16,}\b/g },
  { name: 'us-phone', re: /\b\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { name: 'intl-phone', re: /\+\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g },
];
