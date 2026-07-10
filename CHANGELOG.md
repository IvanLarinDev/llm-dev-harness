# Changelog

- - -
## [v0.5.0](https://github.com/IvanLarinDev/llm-dev-harness/compare/28f4d642c1ea8de19a29bea4beb79abbe2f53bcb..v0.5.0) - 2026-07-10
#### Features
- (**install**) add universal ownership-aware updates - ([109dd82](https://github.com/IvanLarinDev/llm-dev-harness/commit/109dd823e597ccdcc669ecf995773a3ea9cd5cf2)) - agidevway
- (**policy**) add topology and server drift gates - ([59f0dd0](https://github.com/IvanLarinDev/llm-dev-harness/commit/59f0dd0c3e4918b0eb262621c91c037d85e83cfc)) - agidevway
- (**release**) add project artifact contracts - ([a671d44](https://github.com/IvanLarinDev/llm-dev-harness/commit/a671d4490cbc1c6f9973683ded387615245c7242)) - agidevway
#### Bug Fixes
- (**install**) report missing hook activation as pending - ([dffcf89](https://github.com/IvanLarinDev/llm-dev-harness/commit/dffcf890f29c5d35805e7951df5614fab0e95fdc)) - agidevway
- (**process**) fail closed on integrity and release graph - ([3a0b1eb](https://github.com/IvanLarinDev/llm-dev-harness/commit/3a0b1eb15952e7fa84c184785ab30fb4768a62fc)) - agidevway
- (**release**) support detached preparation worktrees - ([73f2b4f](https://github.com/IvanLarinDev/llm-dev-harness/commit/73f2b4ff37655c95c4344340fcdc18338a95b175)) - agidevway

- - -

## [v0.4.0](https://github.com/IvanLarinDev/llm-dev-harness/compare/7020db612e6cde6642c911d6013c83536229ef6b..v0.4.0) - 2026-07-10
#### Features
- (**automation**) add dropwheel harness triage - ([3247110](https://github.com/IvanLarinDev/llm-dev-harness/commit/32471103e361fdfed02d30d8fa24555656f5a8cd)) - agidevway
- (**branches**) clean merged branches after PRs - ([c51ea7a](https://github.com/IvanLarinDev/llm-dev-harness/commit/c51ea7a0ae21e27cec4d2b3776109f7788a33ee8)) - agidevway
#### Bug Fixes
- (**config**) pin PowerShell scripts to LF - ([4b3108e](https://github.com/IvanLarinDev/llm-dev-harness/commit/4b3108e1087b9b842894504f29ada2bc6f48f976)) - agidevway
- (**doctor**) scope source release contract - ([5d92d84](https://github.com/IvanLarinDev/llm-dev-harness/commit/5d92d8420b260d46d7093c96505e2594bb41c241)) - agidevway
- (**harness**) close dropwheel release handoff gaps - ([21992a2](https://github.com/IvanLarinDev/llm-dev-harness/commit/21992a21e2d77cfd4fbf794eb7607f6dbaa81599)) - agidevway
- (**hooks**) enforce converged repository state - ([c1f4a90](https://github.com/IvanLarinDev/llm-dev-harness/commit/c1f4a90f0b8969a2da64b12c6d6cb8838754efeb)) - agidevway
- (**hooks**) merge prerelease csproj parsing - ([f27c794](https://github.com/IvanLarinDev/llm-dev-harness/commit/f27c7940754de1b5c15e42ef86b3f6254e21685c)) - Ivan Larin
- (**hooks**) parse csproj prerelease version - ([ff1701f](https://github.com/IvanLarinDev/llm-dev-harness/commit/ff1701fd75314534ada0d15435832e5a1a5ae4c0)) - Ivan Larin
- (**install**) preserve target changelog - ([92b341f](https://github.com/IvanLarinDev/llm-dev-harness/commit/92b341f882cfab1754a8d59accece978e3ae1d79)) - agidevway
- (**installer**) honor positional target - ([53aa609](https://github.com/IvanLarinDev/llm-dev-harness/commit/53aa609fad62b17a9e5cc3b5bbb980adcbcd1496)) - agidevway
#### Tests
- (**release**) cover slow remote tag checks - ([7020db6](https://github.com/IvanLarinDev/llm-dev-harness/commit/7020db612e6cde6642c911d6013c83536229ef6b)) - agidevway
#### Miscellaneous Chores
- (**agents**) merge release handoff fix - ([5bead09](https://github.com/IvanLarinDev/llm-dev-harness/commit/5bead095a265dd242657d85d91b4ceb99065e3d6)) - agidevway
- (**agents**) merge automation config - ([c383cf6](https://github.com/IvanLarinDev/llm-dev-harness/commit/c383cf6985cb018fb55acfd6c49c7398796bb69b)) - agidevway
- (**agents**) merge accepted main history - ([61f9278](https://github.com/IvanLarinDev/llm-dev-harness/commit/61f9278500e3c9c8fe781494cc1ca03b5f4607e3)) - agidevway
- (**agents**) merge release preflight timeout test - ([bd11028](https://github.com/IvanLarinDev/llm-dev-harness/commit/bd11028527c6177590831d1044c4fcf362b09541)) - Ivan Larin

- - -

## [v0.3.0](https://github.com/IvanLarinDev/llm-dev-harness/compare/78ca25c6608913c624f8f7f4f0e6f53e48fa8697..v0.3.0) - 2026-07-10
#### Features
- (**release**) enforce full release lifecycle - ([5001cc7](https://github.com/IvanLarinDev/llm-dev-harness/commit/5001cc735ebe4143e33432a678279d772c39c61f)) - agidevway

- - -

## [v0.2.0](https://github.com/IvanLarinDev/llm-dev-harness/compare/5463aa53ccdf6ca19669a5594c18d26cc4b4d64d..v0.2.0) - 2026-07-09
#### Features
- (**design**) route mockups by UI change type - ([5463aa5](https://github.com/IvanLarinDev/llm-dev-harness/commit/5463aa53ccdf6ca19669a5594c18d26cc4b4d64d)) - agidevway
#### Documentation
- (**readme**) explain contextual design evidence - ([1e21ca4](https://github.com/IvanLarinDev/llm-dev-harness/commit/1e21ca45692a302c15d0b02444e0a1402c0c3166)) - agidevway
#### Miscellaneous Chores
- (**release**) reconcile v0.1.0 history - ([813a1aa](https://github.com/IvanLarinDev/llm-dev-harness/commit/813a1aad4b58e8a2125fd933e19633e5532f6614)) - agidevway

- - -

## [v0.1.0](https://github.com/IvanLarinDev/llm-dev-harness/compare/a56cf9ff501c4eb403b190cb24fb2ae2b2170bce..v0.1.0) - 2026-07-09
#### Features
- (**agent**) bypass-guard — block agent hook-skips (#1) - ([eda73ed](https://github.com/IvanLarinDev/llm-dev-harness/commit/eda73ed2fcf275ea5f5388548de963431a6c8dad)) - Ivan Larin
- (**ci**) security-гейт agentshield + debug-аудит изменённых файлов (#14) - ([66a8f4f](https://github.com/IvanLarinDev/llm-dev-harness/commit/66a8f4f2683e85e36227f603efd4f8ba9f8d8e79)) - Ivan Larin, agidevway
- (**ci**) add lint-commits conventional-commit backstop for CI (#5) - ([8c5fcf3](https://github.com/IvanLarinDev/llm-dev-harness/commit/8c5fcf3fa5b5e96705f7dd96b1f79d99d569831c)) - Ivan Larin
- (**design**) DESIGN-gate requires >=4 approved mockups for GUI changes (#2) - ([10d4361](https://github.com/IvanLarinDev/llm-dev-harness/commit/10d43619bc25f85194897a6849dbf200db7f3c51)) - Ivan Larin
- (**guard**) таймауты git, атомарный state, детект обхода через интерпретатор (#15) - ([4de933e](https://github.com/IvanLarinDev/llm-dev-harness/commit/4de933e2ffcfa01f0e939f559cae15190dabe5f9)) - Ivan Larin, agidevway
- ![BREAKING](https://img.shields.io/badge/BREAKING-red) (**harness**) Windows-хардненинг guard, verify --changed, чистка доков и CI - ([650c2ed](https://github.com/IvanLarinDev/llm-dev-harness/commit/650c2ede26272fc3fef196d51880db122690936f)) - Ivan Larin
- (**harness**) universal two-layer dev-loop harness (git-native + agent-adapter) - ([a56cf9f](https://github.com/IvanLarinDev/llm-dev-harness/commit/a56cf9ff501c4eb403b190cb24fb2ae2b2170bce)) - Ivan Larin
- (**install**) .gitignore только для .claude/settings.local.json (#18) - ([63a5909](https://github.com/IvanLarinDev/llm-dev-harness/commit/63a59094e8a850d7f0ff04cab9e05a1a11a3dc64)) - Ivan Larin, agidevway
- (**install**) установщик харнесса в один клик (install.js + обёртки) (#16) - ([aeee8b2](https://github.com/IvanLarinDev/llm-dev-harness/commit/aeee8b24cccf4fbd880312fedcb638210d413918)) - Ivan Larin, agidevway
- (**security**) secret-scan, tool-loop-guard, signing helper, CODEOWNERS/Dependabot (#7) - ([0e41990](https://github.com/IvanLarinDev/llm-dev-harness/commit/0e4199045db5d81612b3c58ee0816d652265c499)) - Ivan Larin
- (**tools**) release, doctor, quality-gate, commit helper (P2-11..14) (#11) - ([6fdc491](https://github.com/IvanLarinDev/llm-dev-harness/commit/6fdc491bc07c6bbb06a4c7b6ef12bdb3b3c4d2c9)) - Ivan Larin
- (**verify**) executable multi-stack VERIFY runner (python/dotnet/rust/node) (#4) - ([384419a](https://github.com/IvanLarinDev/llm-dev-harness/commit/384419a84f03b3d32d7dbc562cf3c38cf60ca6b6)) - Ivan Larin
#### Bug Fixes
- (**ci**) run cocogitto check through bash - ([325dda7](https://github.com/IvanLarinDev/llm-dev-harness/commit/325dda768088dff2be348b707530d774e853cbb5)) - agidevway
- (**ci**) install cocogitto on windows runner - ([39f9fcf](https://github.com/IvanLarinDev/llm-dev-harness/commit/39f9fcfa6e26c1455583b476abd590c2ab3fa8c0)) - agidevway
- (**ci**) use canonical gitleaks module path - ([3f85947](https://github.com/IvanLarinDev/llm-dev-harness/commit/3f85947f87f05300ee2f2c2e47f17fa76e384212)) - agidevway
- (**ci**) install gitleaks through go on windows - ([8ae95c2](https://github.com/IvanLarinDev/llm-dev-harness/commit/8ae95c20658458b756fd185bde48b2bf443d258d)) - agidevway
- (**design**) remove NUL bytes from design-gate glob tokens; add source hygiene test (#3) - ([3ea23ed](https://github.com/IvanLarinDev/llm-dev-harness/commit/3ea23edb3eca92fbf7346b12c08d64146bb97c71)) - Ivan Larin
- (**gitattributes**) пинить конфиги на LF, убрать мёртвые hooks/git-строки (#13) - ([54968e4](https://github.com/IvanLarinDev/llm-dev-harness/commit/54968e4b781fe3cf39697c027f3e027b9f91fec1)) - Ivan Larin, agidevway
- (**harness**) normalize changed file scopes - ([8c2537f](https://github.com/IvanLarinDev/llm-dev-harness/commit/8c2537f3d738edbaa9f2888ed9f13f30eacca6c9)) - agidevway
- (**harness**) harden guard red-team fixtures - ([dda858a](https://github.com/IvanLarinDev/llm-dev-harness/commit/dda858a661d6e491b7d568145957b0a3556f131f)) - agidevway
- (**harness**) harden verification and install policy - ([b9263ca](https://github.com/IvanLarinDev/llm-dev-harness/commit/b9263ca0ef7356fc38ddcba734bfd2a6a76296b0)) - agidevway
- (**harness**) add release preflight gate - ([b13eda4](https://github.com/IvanLarinDev/llm-dev-harness/commit/b13eda40d681c4ba420012072c7717f69718707c)) - agidevway
- (**harness**) enforce release and CI contracts - ([ed2b09c](https://github.com/IvanLarinDev/llm-dev-harness/commit/ed2b09c8a76cefe4da17254e68cccb0daac4ce45)) - Ivan Larin
- (**harness**) enforce server-side review and pin ci - ([4b005b2](https://github.com/IvanLarinDev/llm-dev-harness/commit/4b005b26000d1d6d542063344eca97a8ae4b886d)) - agidevway
- (**harness**) harden guard and doctor checks - ([c74b1fc](https://github.com/IvanLarinDev/llm-dev-harness/commit/c74b1fc8de2cbdd3a3dd9a3c96de0e0f7fb4fadc)) - agidevway
- (**harness**) close enforcement gaps - ([4210970](https://github.com/IvanLarinDev/llm-dev-harness/commit/421097046cf8d537c1e818a460b71487a6e9d3bf)) - Ivan Larin, agidevway
- (**hooks**) enforce harness policy gates - ([a85b754](https://github.com/IvanLarinDev/llm-dev-harness/commit/a85b754ad46dd9c7b8af841e95793fa380e6aa03)) - Ivan Larin, agidevway
- (**hooks**) harden protected write detection - ([9956130](https://github.com/IvanLarinDev/llm-dev-harness/commit/9956130d8c118d21e26ba1dc9023632154977f18)) - agidevway
- (**hooks**) split changed-file diff semantics (#20) - ([21df6df](https://github.com/IvanLarinDev/llm-dev-harness/commit/21df6dfa7f647aab008aafd7c1f552c76baf8851)) - Ivan Larin, agidevway
- (**hooks**) close harness rollout gaps - ([433eb41](https://github.com/IvanLarinDev/llm-dev-harness/commit/433eb41bd91741a838dbcd7a3496fc8f83cbed2c)) - Ivan Larin, agidevway
- (**hooks**) accept whitespace and boolean values in HARNESS_ALLOW_MAIN escape hatch - ([21d6251](https://github.com/IvanLarinDev/llm-dev-harness/commit/21d6251b23db6b07a512fc97e96509f844bfd73c)) - Ivan Larin
- (**release**) allow slower remote tag checks - ([812b3ae](https://github.com/IvanLarinDev/llm-dev-harness/commit/812b3aefe31d12011b47fd150b75ecf448e56362)) - Ivan Larin, agidevway
- (**release**) align changelog separator - ([fd8630c](https://github.com/IvanLarinDev/llm-dev-harness/commit/fd8630c52fe3a73439a0148d214a5c97f399ab87)) - Ivan Larin, agidevway
- (**release**) enforce cocogitto readiness - ([d912443](https://github.com/IvanLarinDev/llm-dev-harness/commit/d912443ccbcb698743f5456bd8b096d13e53e46d)) - agidevway
#### Documentation
- (**backlog**) correct P1-9 status (Dependabot live, SHA-pin optional) (#10) - ([3bcc457](https://github.com/IvanLarinDev/llm-dev-harness/commit/3bcc457c2f266fcbf8a5b63f263351dce72b43bc)) - Ivan Larin
#### Continuous Integration
- bump actions/setup-node from 4 to 6 (#9) - ([0a769a9](https://github.com/IvanLarinDev/llm-dev-harness/commit/0a769a9836c4aae65726426eace5b81883191309)) - dependabot[bot], dependabot[bot]
- bump actions/checkout from 4 to 7 (#8) - ([5bee73c](https://github.com/IvanLarinDev/llm-dev-harness/commit/5bee73cbac0a65f5b9df0772a9932edf4c9e97ad)) - dependabot[bot], dependabot[bot]
- add verify workflow (verify.js + lint-commits + design-gate) (#6) - ([2fc5398](https://github.com/IvanLarinDev/llm-dev-harness/commit/2fc5398636d4754aa7e99e6df3a9a90645ccd4f6)) - Ivan Larin
#### Refactoring
- (**harness**) split verify core policy - ([61cd243](https://github.com/IvanLarinDev/llm-dev-harness/commit/61cd24345f0f953191d40909af7029f2a66b2f48)) - agidevway
#### Miscellaneous Chores
- (**gitignore**) игнорировать .claude/ (локальные/проектные настройки раннера) (#17) - ([b6f1351](https://github.com/IvanLarinDev/llm-dev-harness/commit/b6f1351b0506bb65dd249d28e0c16a884f66795a)) - Ivan Larin, agidevway

- - -

