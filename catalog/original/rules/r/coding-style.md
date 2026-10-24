---
paths:
  - "**/*.R"
  - "**/*.r"
  - "**/*.Rmd"
  - "**/*.qmd"
---
# R

For depth, see the `r-patterns` skill.

## Conventions
- **Style:** follow the tidyverse style guide. Use snake_case names, `<-` for assignment, 2-space indents, spaces around operators, at most 80 columns, and `TRUE`/`FALSE` (never `T`/`F`).
- **Pipes:** use one pipe style per file. New code (R 4.1+) uses `|>`; keep `%>%` only where the file already uses it. A package that uses `|>` declares `Depends: R (>= 4.1.0)`.
- **Package code:** call functions as `pkg::fun()` or via `@importFrom`. Never call `library()` or `require()` inside package functions, and add dependencies to `DESCRIPTION` with `usethis::use_package()`.
- **Scripts:** load packages at the top. Don't call `setwd()` or use absolute paths; build paths relative to the project root (`here::here()`).
- **Type stability:**
  - `vapply()` or `purrr::map_*()` instead of `sapply()`.
  - `seq_along()`/`seq_len()` instead of `1:length()`.
  - `dplyr::if_else()` instead of `ifelse()` when values are Dates or factors.
- **Functions over data frames:**
  - Bare columns use `{{ }}`.
  - Column names passed as strings use `.data[[col]]` in data-masking and `all_of()` in tidy-select.
  - One-off grouping uses `.by`, not a lingering `group_by()`.
- **Current dplyr verbs (1.2):** use `reframe()` for multi-row summaries, `pick()` instead of `cur_data()`, and `recode_values()`/`replace_values()` instead of `case_match()`.
- **Loops:** don't grow objects inside them. Preallocate a list and combine it once.
- **Errors:** raise them with `stop()` or `cli::cli_abort()` and a message that names the bad input. Never swallow errors with a bare `try()`.
- **Randomness:** call `set.seed()` in scripts, tests and reports that use random numbers.

## Tools
- **Format:** use Air (`air format .`) or styler (`styler::style_file()`), whichever the repo already uses.
- **Lint:** run `lintr::lint_package()` or `lintr::lint_dir()`, with settings in `.lintr`.
- **Dependencies:** manage them with renv. Run `renv::snapshot()` after adding packages and `renv::restore()` after checkout, and keep `renv::status()` clean.
- **Tests:** use the testthat 3rd edition (`Config/testthat/edition: 3`). For packages run `devtools::test()` and `devtools::check()`; outside packages run `testthat::test_dir("tests/testthat")`.
- **Documents:** render with `quarto render`, or `rmarkdown::render()` for R Markdown projects not on Quarto.
