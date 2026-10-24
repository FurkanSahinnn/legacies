---
name: r-patterns
description: Idiomatic R 4.x for analysis scripts and packages covering tidyverse vs base R, the native pipe, tidy evaluation in functions, dplyr 1.2 verbs, vectorisation and data.table, renv, package development with usethis/devtools/roxygen2/testthat 3e, Quarto, Shiny reactivity and lintr/Air/styler. Use when editing .R, .Rmd or .qmd files, DESCRIPTION, NAMESPACE or renv.lock, writing functions over data frames, building a Shiny app, or fixing R CMD check notes.
---

# R Patterns (R 4.x)

This skill targets R 4.6 (released April 2026). Everything runs on R 4.1 or later unless a version is noted. Package versions referenced: dplyr 1.2, tidyselect 1.2, purrr 1.2, testthat 3.3, renv 1.3 and Shiny 1.14. Before using a version-gated feature, check the project's minimum versions in `DESCRIPTION` (`Depends: R (>= …)`) or `renv.lock`.

## Version facts that change the code you write

- **R 4.1:** native pipe `|>` and the lambda shorthand `\(x) x + 1`.
- **R 4.2:**
  - `|>` gains the `_` placeholder, usable once and only as a named argument: `df |> lm(y ~ x, data = _)`.
  - `if ()` with a condition longer than 1 is an error.
- **R 4.3:**
  - `_` can head an extraction chain: `fit |> _$coefficients[["wt"]]`.
  - `&&` and `||` with an operand longer than 1 are errors.
- **R 4.4:** `%||%` is in base R. Packages that support older R must import it from rlang or define it.
- **dplyr 1.1:**
  - Adds `.by` (grouping for one call), `pick()`, `reframe()` and `join_by()`.
  - `across()` requires `.cols`.
  - `cur_data()` is replaced by `pick()`, and a multi-row `summarise()` by `reframe()`.
- **dplyr 1.2 (Feb 2026):**
  - Adds `filter_out()`, which drops rows where the condition is TRUE and keeps NA rows (unlike `filter(!cond)`).
  - Adds `when_any()`/`when_all()`, `recode_values()`, `replace_values()`, `replace_when()` and `case_when(.unmatched = "error")`.
  - `case_match()` is soft-deprecated.
  - `.by` and `reframe()` are now stable.
- **tidyselect 1.2:**
  - `.data$x` inside `select()`-style arguments is deprecated; use `"x"` or `all_of(var)`.
  - Outside character vectors need `all_of()` or `any_of()`.
- **purrr:**
  - 1.0 supersedes `map_dfr()`/`map_dfc()` with `map() |> list_rbind()`/`list_cbind()`.
  - 1.1 adds `in_parallel()` (mirai).
  - 1.2 stops `map_chr()` from coercing numbers.
- **testthat 3.3:**
  - `with_mock()` and `local_mock()` are defunct; use `local_mocked_bindings()`.
  - New snapshots fail on CI.
- **ggplot2:** `aes_string()` is deprecated; write `aes(.data[[x_var]])`.

## Tidyverse or base R

- **Analysis scripts, reports and Shiny apps:** the tidyverse is fine, because readable, consistent APIs matter most there.
- **Packages:** every `Imports` entry costs install weight and exposes you to API churn. Prefer base R, vctrs, rlang and cli, plus a few targeted imports. Never use `Depends: tidyverse`, and never call `library()` in package code.
- **Code that must run unchanged for years:** base R changes least. Pin everything with renv either way.
- **Consistency:** follow the file's existing style. Within one file, don't mix `%>%` with `|>`, or base and tidyverse idioms for the same job.

## Pipes

- **Choice:** new code on R 4.1 or later uses `|>`, which needs no dependency, adds no call overhead and gives cleaner tracebacks. Where a codebase uses `%>%` consistently, stay with it.
- **Syntax:** `|>` needs a call on the right (`x |> f()`, not `x |> f`) and has no `.` placeholder. When you need the left side twice or nested, write a function or call a lambda: `x |> (\(d) d[d$n > 0, ])()`.
- **magrittr extras:** `%<>%`, `%T>%` and `%$%` have no native equivalent, and they are not a reason to load magrittr.
- **Packages:** a package that uses `|>` declares `Depends: R (>= 4.1.0)`, or 4.2/4.3 for the `_` forms.

## Tidy evaluation inside functions

```r
summarise_by <- function(data, group, value) {
  data |>
    summarise(
      n = n(),
      "mean_{{ value }}" := mean({{ value }}, na.rm = TRUE),
      .by = {{ group }}
    )
}

# Column names that arrive as strings (Shiny inputs, config files)
mean_by <- function(data, group_col, value_col) {
  data |>
    summarise(mean = mean(.data[[value_col]], na.rm = TRUE), .by = all_of(group_col))
}
```

- **Bare column arguments:** embrace them as `{{ arg }}`.
- **String arguments:**
  - In data-masking verbs (`mutate`, `filter`, `summarise`, `arrange`, `aes`), use `.data[[arg]]`.
  - In tidy-select arguments (`select`, `across`, `.by`, `pivot_longer(cols =)`), use `all_of()` or `any_of()`.
- **Dots:** forward `...` unchanged (`group_by(...)`). Capture it with `enquos()` only when you must inspect it.
- **Name clashes:** when an argument shares its name with a column, the column wins, so `filter(df, year == year)` compares the column with itself. Use `.env$year` or rename the argument.
- **"No visible binding" NOTE in packages:** in data-masking verbs use `.data$col` with `@importFrom rlang .data`, and in tidy-select use strings. Use `utils::globalVariables()` only as a last resort.
- **Legacy forms:** don't use `!!sym()`/`enquo()` where `{{ }}` or `.data[[ ]]` does the job, and drop underscore verbs (`mutate_()`), `funs()` and `aes_string()`.
- **Grouping:** `group_by()` output stays grouped and surprises the next step. Use `.by` for one-off grouping, or end with `ungroup()`. A `summarise()` that returns several rows per group should be `reframe()`.

## Base R correctness traps

| Trap | Fix |
|---|---|
| `1:length(x)` and `1:n` misbehave at length 0 | `seq_along(x)`, `seq_len(n)` |
| `sapply()` returns a list or a vector depending on input | `vapply(x, f, numeric(1))` or `purrr::map_dbl()` |
| `ifelse()` drops attributes, so Dates become numbers | `dplyr::if_else()` or `data.table::fifelse()` |
| `df[, cols]` returns a vector when one column matches | `df[, cols, drop = FALSE]` |
| `T` and `F` are ordinary variables | `TRUE` and `FALSE` |
| Doubles compared with `==` | `isTRUE(all.equal(a, b))` or an explicit tolerance |
| `as.numeric(f)` on a factor returns level codes | `as.numeric(as.character(f))` |
| `sample(x)` with a single number samples `1:x` | `x[sample.int(length(x))]` |
| `$` partial-matches names on lists and data frames | `x[["name"]]` |
| Growing a vector or data frame in a loop is quadratic | Preallocate `vector("list", n)`, fill `out[[i]]`, then combine once (`list_rbind()`, `data.table::rbindlist()`) |
| `setwd()` and absolute paths | Paths relative to the project root (`here::here()`), with `library()` calls at the top of the script, never inside functions |

## Vectorisation and performance

- **Order of approach:** vectorise first, then reach for `vapply()` or `map_*()`. A preallocated loop is fine; copying is what's slow, not looping.
- **Measure before rewriting:** use `bench::mark()` for snippets and `profvis::profvis()` for whole code paths.
- **Choosing an engine:**
  - dplyr, for readability up to a few million rows.
  - data.table, for large in-memory data, grouped aggregation, joins, low memory use and fast `fread()`/`fwrite()`. dtplyr gives dplyr syntax on top.
  - arrow (`open_dataset()`), duckdb or duckplyr, for larger-than-memory data and folders of Parquet or CSV files.
  - Rcpp or cpp11, for an inner loop that can't be vectorised.
  - `purrr::in_parallel()`, future or furrr, for parallel maps.
- **data.table modifies by reference:** `:=` and `set*()` inside a function change the caller's table, and `dt2 <- dt` doesn't copy:

```r
add_total <- function(dt) {
  dt <- data.table::copy(dt)
  dt[, total := price * qty][]
}
```

## Reproducibility with renv

- **Setup:** run `renv::init()` once. Commit `renv.lock`, `.Rprofile`, `renv/activate.R` and `renv/settings.json`. `renv/library/` is already excluded by `renv/.gitignore`.
- **Workflow:** `renv::install("pkg")`, use the package, then `renv::snapshot()`. Collaborators and CI run `renv::restore()`, and `renv::status()` reports drift, so make CI fail on it.
- **Snapshot type:**
  - "implicit" (the default) scans code for `library()` and `pkg::` calls.
  - "explicit" records only the dependencies in `DESCRIPTION`, which suits projects that have one.
  - renv 1.3 and later also honours the version constraints in `DESCRIPTION`.
- **R itself:** the lockfile records the R version, so install that version (with rig or a `rocker/r-ver:<version>` image). On Linux CI, install binaries from Posit Package Manager rather than compiling from source.
- **Packages:** in a package, renv pins only the development environment; users get the ranges declared in `DESCRIPTION`.
- **Randomness and environment:** call `set.seed()` before any randomness, and print `sessionInfo()` in reports.

## Package development

- **Scaffold with usethis:**
  - `create_package()`, `use_r("parse")`, `use_test("parse")`, `use_testthat(3)`.
  - `use_package("vctrs")` for Imports or `use_package("withr", "Suggests")`, and `use_import_from("rlang", ".data")`.
  - `use_mit_license()`, `use_news_md()`, `use_github_action("check-standard")`, `use_air()`.
- **Inner loop:** `devtools::load_all()`, `document()`, `test()`, then `check()`. Aim for 0 errors, 0 warnings and 0 notes.
- **roxygen2:** turn Markdown on (`Roxygen: list(markdown = TRUE)`) and never hand-edit `NAMESPACE` or `man/`.
  - Export deliberately with `@export`.
  - Import narrowly with `@importFrom pkg fun` or `pkg::fun()`, not `@import` of whole packages.
  - Reuse argument docs with `@inheritParams` and document return values with `@returns`.
  - Wrap examples that need a network or credentials in `@examplesIf`.
- **DESCRIPTION fields:** `Imports` for runtime needs. `Suggests` for tests, vignettes and optional features, checked with `rlang::check_installed("pkg")`. `Depends` only for the R version.
- **Conditions:** signal them with `cli::cli_abort("{.arg path} must exist.", class = "mypkg_error_missing_file")`, then test the class or snapshot the message.

Tests use the testthat 3rd edition (`Config/testthat/edition: 3` in `DESCRIPTION`):

```r
test_that("summarise_by() returns one row per group", {
  df <- tibble::tibble(g = c("a", "a", "b"), x = c(1, 3, 5))
  out <- summarise_by(df, g, x)
  expect_named(out, c("g", "n", "mean_x"))
  expect_equal(out$mean_x, c(2, 5))
})

test_that("read_config() explains a missing file", {
  expect_snapshot(read_config("missing.yml"), error = TRUE)
})

test_that("fetch_rates() falls back to the cache when offline", {
  local_mocked_bindings(download_rates = function(...) stop("offline"))
  expect_equal(fetch_rates()$source, "cache")
})
```

- **Snapshots:** `expect_equal()` compares with waldo, and `expect_snapshot()` covers printed output, messages and errors. Review changes with `testthat::snapshot_review()` and commit `tests/testthat/_snaps/`. Create new snapshots locally, because new ones fail on CI.
- **Mocking:** `local_mocked_bindings()` replaces a function in your package's namespace for one test. To mock a base or third-party function, call it through a small internal wrapper and mock the wrapper.
- **Side effects and skips:** undo side effects with `withr::local_options()`, `local_envvar()` and `local_tempfile()`. Skip with `skip_on_cran()`, `skip_if_not_installed()` and `skip_if_offline()`.
- **Gone in 3e:** `context()`, `expect_is()`, `expect_equivalent()`, `setup()`/`teardown()` (use withr or `tests/testthat/setup.R`) and `with_mock()`.

## Quarto and R Markdown

- **Format:** new documents use Quarto (`.qmd`), with chunk options written as `#|` comments (`#| label: fig-trend`, `#| echo: false`). Existing `.Rmd` files still render with rmarkdown or Quarto.
- **Computation:** keep heavy work in R functions or a targets pipeline, and have documents load the results and present them. That is more reliable than knitr caching.
- **Projects:** set `execute: freeze: auto` in `_quarto.yml` and commit `_freeze/`, so CI renders without re-running the code.
- **Parameterised reports:** declare `params:` in the YAML header and render with `quarto render report.qmd -P year:2026`.

## Shiny reactivity

```r
server <- function(input, output, session) {
  region_sales <- reactive({
    req(input$region)
    sales |> filter(region == input$region)
  })
  output$trend <- renderPlot(plot_trend(region_sales())) |> bindCache(input$region)

  forecast <- ExtendedTask$new(function(data) {
    promises::future_promise(fit_forecast(data))  # with future::plan(multisession)
  }) |> bslib::bind_task_button("run")
  observeEvent(input$run, forecast$invoke(region_sales()))
  output$forecast <- renderTable(forecast$result())
}
```

- **Values vs side effects:** `reactive()` computes values (lazily, and caches them), while `observe()` and `observeEvent()` perform side effects. Don't compute values in an observer that writes to a `reactiveVal`, and never put side effects in `reactive()`.
- **Startup:** wrap every input that can be NULL or empty at startup in `req()`.
- **Event and cache bindings:** for button-driven work use `bindEvent()` or `eventReactive()`. For expensive pure outputs use `bindCache()`.
- **Long work:** a slow computation blocks every session in the R process. Run it in an `ExtendedTask` (Shiny 1.8.1 or later) with `bslib::input_task_button()`. Pass inputs to `invoke()` as arguments, because the task can't read reactives.
- **Updating inputs:** change existing inputs with `update*Input()`. Re-rendering them in `renderUI()` loses their state.
- **Modules:** use `moduleServer(id, function(input, output, session) …)` and wrap every UI id in `NS(id)`. Ids created inside a module's `renderUI()` need `session$ns()`.
- **Scope:** top-level code in `app.R` or `global.R` runs once per process and is shared by all sessions. Per-user state belongs inside `server`.
- **Testing:** test server logic with `testServer()` and whole apps with shinytest2.

## Lint and format

- **Formatter:** use Air: `air format .` locally, `air format . --check` in CI, settings in `air.toml`, and setup via `usethis::use_air()`. The tidyverse has moved from styler to Air. Where a project already uses styler (`styler::style_pkg()`), keep it, and never run both.
- **Linter:** use lintr, with `lintr::lint_package()` or `lintr::lint_dir()` and a `.lintr` config created by `lintr::use_lintr()`. The defaults follow the tidyverse style guide: snake_case names, `<-` for assignment, 80 columns, and implicit `return()` since lintr 3.2.

## Review checklist

- [ ] Each file uses one pipe style, and the R version dependency is declared for `|>` and `_`.
- [ ] Functions over data frames use `{{ }}`, `.data[[ ]]` or `all_of()`, with no `aes_string()`, underscore verbs, `funs()` or new `case_match()`.
- [ ] There is no `sapply()`, `1:length()`, `ifelse()` on Dates, `T`/`F`, or vector grown in a loop.
- [ ] Grouping is explicit (`.by` or `ungroup()`), and data.table arguments are `copy()`'d before `:=`.
- [ ] Package code has no `library()`, `require()` or `setwd()`, dependencies are in `DESCRIPTION`, and `devtools::check()` is clean.
- [ ] Tests use the testthat 3rd edition, snapshots are committed, and mocks use `local_mocked_bindings()`.
- [ ] `renv::status()` is clean after dependency changes, and `renv.lock` is committed.
- [ ] In Shiny, values are in `reactive()`, effects are in observers, inputs go through `req()`, and slow work runs in an `ExtendedTask`.
- [ ] Air (or styler) and lintr report nothing.

<!-- Written for legacies (MIT). Checked against: https://cran.r-project.org/doc/manuals/r-release/NEWS.html, https://search.r-project.org/R/refmans/base/html/pipeOp.html, https://dplyr.tidyverse.org/news/, https://tidyselect.r-lib.org/news/, https://purrr.tidyverse.org/news/, https://testthat.r-lib.org/news/, https://rstudio.github.io/renv/news/, https://shiny.posit.co/r/reference/shiny/latest/, https://shiny.posit.co/r/articles/improve/nonblocking/, https://posit-dev.github.io/air/, https://usethis.r-lib.org/reference/use_air.html, https://lintr.r-lib.org/news/, 2026-10 -->
