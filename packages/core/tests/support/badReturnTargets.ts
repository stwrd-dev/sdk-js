// Redirect targets that must never survive a return_to guard. Shared by the
// core `safeTarget` tests and the `@stwrd/react` `SignInButton` tests so both
// guards are held to one list.
export const BAD_RETURN_TARGETS: string[] = [
  "//evil.example",
  "/\\evil.example",
  "/a\\evil.example",
  "https://evil.example/",
  "javascript:alert(1)",
  "",
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r\n/evil.example",
  "/a\tb",
  "/a\u0000b",
  "/a\u007fb",
  "/..//evil.com",
  "/.//evil.com",
  "/a/..//evil.com",
];
