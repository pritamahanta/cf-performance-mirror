/*
 * Syntax highlighting for the submission source overlay, with the same
 * token classes Codeforces' own source view uses (google-code-prettify:
 * pln, kwd, typ, com, str, lit, pun).
 *
 * The page Codeforces serves holds the source as plain text; its colors
 * are added in the browser by a script, so a fetched copy of the page has
 * none. This reproduces that classification instead.
 *
 * It is one generic tokenizer for C-like languages (C, C++, Java, C#, ...)
 * plus a Python mode, chosen from the text itself: the language of a
 * submission is not part of what the overlay is given.
 */

export type TokenType = 'pln' | 'kwd' | 'typ' | 'com' | 'str' | 'lit' | 'pun';

export interface Token {
  type: TokenType;
  text: string;
}

const words = (list: string) => new Set(list.split(/[\s,]+/).filter(Boolean));

const C_LIKE_KEYWORDS = words(`
  break continue do else for if return while
  auto case char const default double enum extern goto inline long register
  restrict short signed sizeof static struct switch typedef union unsigned
  void volatile
  catch class delete false import new operator private protected public
  this throw true try typeof using namespace nullptr bool template typename
  constexpr decltype virtual explicit mutable friend
  static_cast dynamic_cast reinterpret_cast const_cast
  abstract assert boolean byte extends final finally implements instanceof
  interface null native package strictfp super synchronized throws transient
`);

const PYTHON_KEYWORDS = words(`
  and as assert break class continue def del elif else except finally for
  from global if import in is lambda nonlocal not or pass print raise
  return try while with yield False True None
`);

/* Standard-library types that are classed apart from keywords (int and float included). */
const C_LIKE_TYPE =
  /^(?:DIR|FILE|array|vector|(?:de|priority_)?queue|(?:forward_)?list|stack|(?:const_)?(?:reverse_)?iterator|(?:unordered_)?(?:multi)?(?:set|map)|bitset|u?(?:int|float)\d*)$/;

const WHITESPACE = /\s+/y;
const LINE_COMMENT = /\/\/[^\n]*/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y;
const HASH_C_LIKE =
  /#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\r\n]*)/y;
const HASH_COMMENT = /#[^\r\n]*/y;
const TRIPLE_STRING = /(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y;

/* A quoted string ends at its closing quote or, if unclosed, at the end of the line. */
const STRING =
  /"(?:[^"\\\n]|\\[\s\S])*(?:"|(?=\n)|$)|'(?:[^'\\\n]|\\[\s\S])*(?:'|(?=\n)|$)/y;

const NUMBER =
  /(?:0[xX][0-9a-fA-F]+|(?:\d+(?:_\d+)*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;

const IDENTIFIER = /[A-Za-z_$\u0080-\uFFFF][\w$\u0080-\uFFFF]*/y;

/*
 * Python or C-like, from the text. Python is picked only when it has
 * Python-only statement lines (def/class/elif/... ending in a colon, or
 * import lines) and no more C-style line endings (; or {) than those.
 */
export function looksLikePython(source: string): boolean {
  const pythonLines =
    (
      source.match(
        /^[ \t]*(?:def|class|elif|else|try|except|finally|with|for|while|if)\b[^;{}\n]*:[ \t]*$/gm,
      ) ?? []
    ).length +
    (
      source.match(
        /^[ \t]*(?:import\s+\w[^;{}\n]*|from\s+\S+\s+import\b[^;{}\n]*)$/gm,
      ) ?? []
    ).length;

  if (pythonLines === 0) {
    return false;
  }

  const cLines = (source.match(/[;{][ \t]*$/gm) ?? []).length;

  return pythonLines > cLines;
}

export function highlight(source: string): Token[] {
  const python = looksLikePython(source);
  const tokens: Token[] = [];

  const push = (type: TokenType, text: string) => {
    if (!text) {
      return;
    }

    const last = tokens[tokens.length - 1];

    if (last && last.type === type) {
      last.text += text;
    } else {
      tokens.push({ type, text });
    }
  };

  const match = (pattern: RegExp, at: number): string | null => {
    pattern.lastIndex = at;

    const found = pattern.exec(source);

    return found && found[0].length > 0 ? found[0] : null;
  };

  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    let text = match(WHITESPACE, i);

    if (text) {
      push('pln', text);
      i += text.length;
      continue;
    }

    if (python) {
      text = match(HASH_COMMENT, i);

      if (text) {
        push('com', text);
        i += text.length;
        continue;
      }

      text = match(TRIPLE_STRING, i);
    } else {
      if (ch === '/') {
        text = match(LINE_COMMENT, i) ?? match(BLOCK_COMMENT, i);

        if (text) {
          push('com', text);
          i += text.length;
          continue;
        }
      }

      if (ch === '#') {
        text = match(HASH_C_LIKE, i);

        if (text) {
          push('com', text);
          i += text.length;
          continue;
        }
      }

      text = null;
    }

    text = text ?? match(STRING, i);

    if (text) {
      push('str', text);
      i += text.length;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      text = match(NUMBER, i);

      if (text) {
        push('lit', text);
        i += text.length;
        continue;
      }
    }

    text = match(IDENTIFIER, i);

    if (text) {
      let type: TokenType = 'pln';

      if (python) {
        if (PYTHON_KEYWORDS.has(text)) {
          type = 'kwd';
        }
      } else if (C_LIKE_TYPE.test(text)) {
        type = 'typ';
      } else if (C_LIKE_KEYWORDS.has(text)) {
        type = 'kwd';
      }

      push(type, text);
      i += text.length;
      continue;
    }

    push('pun', ch);
    i += 1;
  }

  return tokens;
}
