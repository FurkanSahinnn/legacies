---
name: cpp-coding-standards
description: C++ coding standards based on the C++ Core Guidelines (isocpp.github.io). Use when writing, reviewing, or refactoring C++ code to enforce modern, safe, and idiomatic practices.
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): skills/cpp-coding-standards/SKILL.md -->

# C++ Coding Standards (C++ Core Guidelines)

Comprehensive coding standards for modern C++ (C++17/20/23) derived from the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines). Enforces type safety, resource safety, immutability, and clarity.

Rule IDs such as P.1 or R.11 refer to the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines); the rule summaries in this skill are paraphrased, not quoted.

## When to Use

- Writing new C++ code (classes, functions, templates)
- Reviewing or refactoring existing C++ code
- Making architectural decisions in C++ projects
- Enforcing consistent style across a C++ codebase
- Choosing between language features (e.g., `enum` vs `enum class`, raw pointer vs smart pointer)

### When NOT to Use

- Non-C++ projects
- Legacy C codebases that cannot adopt modern C++ features
- Embedded/bare-metal contexts where specific guidelines conflict with hardware constraints (adapt selectively)

## Cross-Cutting Principles

These themes recur across the entire guidelines and form the foundation:

1. **RAII everywhere** (P.8, R.1, E.6, CP.20): Bind resource lifetime to object lifetime
2. **Immutability by default** (P.10, Con.1-5, ES.25): Start with `const`/`constexpr`; mutability is the exception
3. **Type safety** (P.4, I.4, ES.46-49, Enum.3): Use the type system to prevent errors at compile time
4. **Make intent clear** (P.3, F.1, NL.1-2, T.10): Names, types, and concepts should communicate purpose
5. **Minimize complexity** (F.2-3, ES.5, Per.4-5): Simple code is correct code
6. **Value semantics over pointer semantics** (C.10, R.3-5, F.20, CP.31): Prefer returning by value and scoped objects

## Philosophy & Interfaces (P.*, I.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **P.1** | Let the code itself state what you mean |
| **P.3** | Make the purpose of the code obvious |
| **P.4** | Aim for code the compiler can fully type-check |
| **P.5** | Let the compiler find errors before the program runs |
| **P.8** | Make sure every resource gets released |
| **P.10** | Favor data that cannot change over data that can |
| **I.1** | Let an interface show everything it relies on |
| **I.2** | Keep globals read-only |
| **I.4** | Use exact, meaningful types at interface boundaries |
| **I.11** | A plain pointer or reference must not pass ownership |
| **I.23** | Limit how many parameters a function takes |

### DO

```cpp
// P.10 + I.4: Immutable, strongly typed interface
struct Temperature {
    double kelvin;
};

Temperature boil(const Temperature& water);
```

### DON'T

```cpp
// Weak interface: unclear ownership, unclear units
double boil(double* temp);

// Non-const global variable
int g_counter = 0;  // I.2 violation
```

## Functions (F.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **F.1** | Wrap each useful operation in a function with a clear name |
| **F.2** | Give each function exactly one job |
| **F.3** | Write small, easy-to-follow functions |
| **F.4** | Mark a function `constexpr` when it may be needed at compile time |
| **F.6** | Use `noexcept` on functions that are never allowed to throw |
| **F.8** | Favor functions with no side effects |
| **F.16** | Take inputs that are cheap to copy by value; take the rest as `const&` |
| **F.20** | Return results instead of writing them through parameters |
| **F.21** | Bundle several results into a struct and return that |
| **F.43** | Never let a reference or address of a local outlive the function |

### Parameter Passing

```cpp
// F.16: Cheap types by value, others by const&
void print(int x);                           // cheap: by value
void analyze(const std::string& data);       // expensive: by const&
void transform(std::string s);               // sink: by value (will move)

// F.20 + F.21: Return values, not output parameters
struct ParseResult {
    std::string token;
    int position;
};

ParseResult parse(std::string_view input);   // GOOD: return struct

// BAD: output parameters
void parse(std::string_view input,
           std::string& token, int& pos);    // avoid this
```

### Pure Functions and constexpr

```cpp
// F.4 + F.8: Pure, constexpr where possible
constexpr int factorial(int n) noexcept {
    return (n <= 1) ? 1 : n * factorial(n - 1);
}

static_assert(factorial(5) == 120);
```

### Anti-Patterns

- Returning `T&&` from functions (F.45)
- Using `va_arg` / C-style variadics (F.55)
- Capturing by reference in lambdas passed to other threads (F.53)
- Returning `const T` which inhibits move semantics (F.49)

## Classes & Class Hierarchies (C.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **C.2** | Pick `class` when members must stay consistent, `struct` when each can change freely |
| **C.9** | Keep members as private as you can |
| **C.20** | Don't write special member functions you can do without (Rule of Zero) |
| **C.21** | Once you write or `=delete` a destructor, copy or move operation, spell out all five (Rule of Five) |
| **C.35** | A public base-class destructor must be virtual; a non-virtual one must be protected |
| **C.41** | Constructors must leave the object completely ready to use |
| **C.46** | Mark one-argument constructors `explicit` unless you want implicit conversion |
| **C.67** | Classes with virtual functions should not be publicly copyable or movable |
| **C.128** | Give each virtual function a single specifier: `virtual`, `override` or `final` |

### Rule of Zero

```cpp
// C.20: Let the compiler generate special members
struct Employee {
    std::string name;
    std::string department;
    int id;
    // No destructor, copy/move constructors, or assignment operators needed
};
```

### Rule of Five

```cpp
// C.21: If you must manage a resource, define all five
class Buffer {
public:
    explicit Buffer(std::size_t size)
        : data_(std::make_unique<char[]>(size)), size_(size) {}

    ~Buffer() = default;

    Buffer(const Buffer& other)
        : data_(std::make_unique<char[]>(other.size_)), size_(other.size_) {
        std::copy_n(other.data_.get(), size_, data_.get());
    }

    Buffer& operator=(const Buffer& other) {
        if (this != &other) {
            auto new_data = std::make_unique<char[]>(other.size_);
            std::copy_n(other.data_.get(), other.size_, new_data.get());
            data_ = std::move(new_data);
            size_ = other.size_;
        }
        return *this;
    }

    Buffer(Buffer&&) noexcept = default;
    Buffer& operator=(Buffer&&) noexcept = default;

private:
    std::unique_ptr<char[]> data_;
    std::size_t size_;
};
```

### Class Hierarchy

```cpp
// C.35 + C.128: Virtual destructor, use override
class Shape {
public:
    virtual ~Shape() = default;
    virtual double area() const = 0;  // C.121: pure interface
};

class Circle : public Shape {
public:
    explicit Circle(double r) : radius_(r) {}
    double area() const override { return 3.14159 * radius_ * radius_; }

private:
    double radius_;
};
```

### Anti-Patterns

- Calling virtual functions in constructors/destructors (C.82)
- Using `memset`/`memcpy` on non-trivial types (C.90)
- An override whose default argument values differ from the base declaration's (C.140)
- Making data members `const` or references, which suppresses move/copy (C.12)

## Resource Management (R.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **R.1** | Let objects that own resources release them automatically (RAII) |
| **R.3** | A plain `T*` only borrows; it never owns |
| **R.5** | Keep objects local; use the heap only when you must |
| **R.10** | Leave `malloc()`/`free()` to C code |
| **R.11** | Don't write `new`/`delete` by hand |
| **R.20** | Owning pointers should be `unique_ptr` or `shared_ptr` |
| **R.21** | Default to `unique_ptr`; use `shared_ptr` only when there are several owners |
| **R.22** | Create each `shared_ptr` with `make_shared()` rather than `new` |

### Smart Pointer Usage

```cpp
// R.11 + R.20 + R.21: RAII with smart pointers
auto widget = std::make_unique<Widget>("config");  // unique ownership
auto cache  = std::make_shared<Cache>(1024);        // shared ownership

// R.3: Raw pointer = non-owning observer
void render(const Widget* w) {  // does NOT own w
    if (w) w->draw();
}

render(widget.get());
```

### RAII Pattern

```cpp
// R.1: Resource acquisition is initialization
class FileHandle {
public:
    explicit FileHandle(const std::string& path)
        : handle_(std::fopen(path.c_str(), "r")) {
        if (!handle_) throw std::runtime_error("Failed to open: " + path);
    }

    ~FileHandle() {
        if (handle_) std::fclose(handle_);
    }

    FileHandle(const FileHandle&) = delete;
    FileHandle& operator=(const FileHandle&) = delete;
    FileHandle(FileHandle&& other) noexcept
        : handle_(std::exchange(other.handle_, nullptr)) {}
    FileHandle& operator=(FileHandle&& other) noexcept {
        if (this != &other) {
            if (handle_) std::fclose(handle_);
            handle_ = std::exchange(other.handle_, nullptr);
        }
        return *this;
    }

private:
    std::FILE* handle_;
};
```

### Anti-Patterns

- Naked `new`/`delete` (R.11)
- `malloc()`/`free()` in C++ code (R.10)
- Multiple resource allocations in a single expression (R.13 -- exception safety hazard)
- `shared_ptr` where `unique_ptr` suffices (R.21)

## Expressions & Statements (ES.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **ES.5** | Give each name the narrowest scope that works |
| **ES.20** | Give every object a value when you declare it |
| **ES.23** | Initialize with braces `{}` by default |
| **ES.25** | Objects you won't change should be `const` or `constexpr` |
| **ES.28** | Initialize a `const` with a lambda when setup takes several steps |
| **ES.45** | Name your constants instead of scattering bare literals |
| **ES.46** | Don't let numeric conversions drop data or precision |
| **ES.47** | Spell the null pointer as `nullptr`, not `0` or `NULL` |
| **ES.48** | Cast only when there is no better option |
| **ES.50** | Never strip `const` with a cast |

### Initialization

```cpp
// ES.20 + ES.23 + ES.25: Always initialize, prefer {}, default to const
const int max_retries{3};
const std::string name{"widget"};
const std::vector<int> primes{2, 3, 5, 7, 11};

// ES.28: Lambda for complex const initialization
const auto config = [&] {
    Config c;
    c.timeout = std::chrono::seconds{30};
    c.retries = max_retries;
    c.verbose = debug_mode;
    return c;
}();
```

### Anti-Patterns

- Uninitialized variables (ES.20)
- Using `0` or `NULL` as pointer (ES.47 -- use `nullptr`)
- C-style casts (ES.48 -- use `static_cast`, `const_cast`, etc.)
- Casting away `const` (ES.50)
- Magic numbers without named constants (ES.45)
- Mixing signed and unsigned arithmetic (ES.100)
- Reusing names in nested scopes (ES.12)

## Error Handling (E.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **E.1** | Settle how errors are handled before writing much code |
| **E.2** | Throw when a function cannot do its job |
| **E.6** | Let RAII clean up so errors cannot cause leaks |
| **E.12** | Add `noexcept` where a throw either can't happen or can't be tolerated |
| **E.14** | Throw custom exception classes, not `int`s or strings |
| **E.15** | Throw exception objects (not pointers); catch them as `const&` |
| **E.16** | Make destructors, deallocation and `swap` failure-proof |
| **E.17** | Only catch an exception where you can actually deal with it |

### Exception Hierarchy

```cpp
// E.14 + E.15: Custom exception types, throw by value, catch by reference
class AppError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

class NetworkError : public AppError {
public:
    NetworkError(const std::string& msg, int code)
        : AppError(msg), status_code(code) {}
    int status_code;
};

void fetch_data(const std::string& url) {
    // E.2: Throw to signal failure
    throw NetworkError("connection refused", 503);
}

void run() {
    try {
        fetch_data("https://api.example.com");
    } catch (const NetworkError& e) {
        log_error(e.what(), e.status_code);
    } catch (const AppError& e) {
        log_error(e.what());
    }
    // E.17: Don't catch everything here -- let unexpected errors propagate
}
```

### Anti-Patterns

- Throwing built-in types like `int` or string literals (E.14)
- Catching by value (slicing risk) (E.15)
- Empty catch blocks that silently swallow errors
- Using exceptions for flow control (E.3)
- Reporting failures through a shared global such as `errno` (E.28)

## Constants & Immutability (Con.*)

### All Rules

| Rule | Summary |
|------|---------|
| **Con.1** | Start every object as `const`; drop `const` only when needed |
| **Con.2** | A member function that leaves the object unchanged should be `const` |
| **Con.3** | Pointer and reference parameters should refer to `const` data unless the function changes it |
| **Con.4** | Mark an object `const` if it stays the same once built |
| **Con.5** | Declare a value `constexpr` when the compiler can work it out |

```cpp
// Con.1 through Con.5: Immutability by default
class Sensor {
public:
    explicit Sensor(std::string id) : id_(std::move(id)) {}

    // Con.2: const member functions by default
    const std::string& id() const { return id_; }
    double last_reading() const { return reading_; }

    // Only non-const when mutation is required
    void record(double value) { reading_ = value; }

private:
    const std::string id_;  // Con.4: never changes after construction
    double reading_{0.0};
};

// Con.3: Pass by const reference
void display(const Sensor& s) {
    std::cout << s.id() << ": " << s.last_reading() << '\n';
}

// Con.5: Compile-time constants
constexpr double PI = 3.14159265358979;
constexpr int MAX_SENSORS = 256;
```

## Concurrency & Parallelism (CP.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **CP.2** | Don't let threads read and write shared data unsynchronized |
| **CP.3** | Share as little mutable data between threads as you can |
| **CP.4** | Design around units of work, not threads |
| **CP.8** | `volatile` is not a thread synchronization tool |
| **CP.20** | Hold locks through RAII guards, not manual `lock()`/`unlock()` calls |
| **CP.21** | Take several mutexes together with `std::scoped_lock` |
| **CP.22** | While a lock is held, don't call code you don't control |
| **CP.42** | Every condition-variable wait needs a predicate to check |
| **CP.44** | Give every `lock_guard` and `unique_lock` a variable name |
| **CP.100** | Write lock-free code only as a last resort |

### Safe Locking

```cpp
// CP.20 + CP.44: RAII locks, always named
class ThreadSafeQueue {
public:
    void push(int value) {
        std::lock_guard<std::mutex> lock(mutex_);  // CP.44: named!
        queue_.push(value);
        cv_.notify_one();
    }

    int pop() {
        std::unique_lock<std::mutex> lock(mutex_);
        // CP.42: Always wait with a condition
        cv_.wait(lock, [this] { return !queue_.empty(); });
        const int value = queue_.front();
        queue_.pop();
        return value;
    }

private:
    std::mutex mutex_;             // CP.50: mutex with its data
    std::condition_variable cv_;
    std::queue<int> queue_;
};
```

### Multiple Mutexes

```cpp
// CP.21: std::scoped_lock for multiple mutexes (deadlock-free)
void transfer(Account& from, Account& to, double amount) {
    std::scoped_lock lock(from.mutex_, to.mutex_);
    from.balance_ -= amount;
    to.balance_ += amount;
}
```

### Anti-Patterns

- `volatile` for synchronization (CP.8 -- it's for hardware I/O only)
- Detaching threads (CP.26 -- lifetime management becomes nearly impossible)
- Unnamed lock guards: `std::lock_guard<std::mutex>(m);` destroys immediately (CP.44)
- Holding locks while calling callbacks (CP.22 -- deadlock risk)
- Lock-free programming without deep expertise (CP.100)

## Templates & Generic Programming (T.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **T.1** | Turn type-specific code into general code with templates |
| **T.2** | Write an algorithm once as a template so it works for many types |
| **T.10** | Constrain every template parameter with a concept |
| **T.11** | Reach for the standard library's concepts before writing your own |
| **T.13** | For simple one-type constraints, use the compact concept syntax |
| **T.43** | Write type aliases with `using`, not `typedef` |
| **T.120** | Keep template metaprogramming for cases nothing simpler can handle |
| **T.144** | Leave function templates unspecialized (overload instead) |

### Concepts (C++20)

```cpp
#include <concepts>

// T.10 + T.11: Constrain templates with standard concepts
template<std::integral T>
T gcd(T a, T b) {
    while (b != 0) {
        a = std::exchange(b, a % b);
    }
    return a;
}

// T.13: Shorthand concept syntax
void sort(std::ranges::random_access_range auto& range) {
    std::ranges::sort(range);
}

// Custom concept for domain-specific constraints
template<typename T>
concept Serializable = requires(const T& t) {
    { t.serialize() } -> std::convertible_to<std::string>;
};

template<Serializable T>
void save(const T& obj, const std::string& path);
```

### Anti-Patterns

- Unconstrained templates in visible namespaces (T.47)
- Specializing function templates instead of overloading (T.144)
- Template metaprogramming where `constexpr` suffices (T.120)
- `typedef` instead of `using` (T.43)

## Standard Library (SL.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **SL.1** | Reuse existing libraries before writing your own code |
| **SL.2** | Check `std` first, third-party libraries second |
| **SL.con.1** | Replace C arrays with `std::array` or `std::vector` |
| **SL.con.2** | Make `std::vector` your first-choice container |
| **SL.str.1** | Store owned text in `std::string` |
| **SL.str.2** | View text you don't own through `std::string_view` |
| **SL.io.50** | Don't end lines with `endl` (use `'\n'` -- `endl` forces a flush) |

```cpp
// SL.con.1 + SL.con.2: Prefer vector/array over C arrays
const std::array<int, 4> fixed_data{1, 2, 3, 4};
std::vector<std::string> dynamic_data;

// SL.str.1 + SL.str.2: string owns, string_view observes
std::string build_greeting(std::string_view name) {
    return "Hello, " + std::string(name) + "!";
}

// SL.io.50: Use '\n' not endl
std::cout << "result: " << value << '\n';
```

## Enumerations (Enum.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **Enum.1** | Define related constants as an enum, not as macros |
| **Enum.3** | Choose scoped `enum class` over unscoped `enum` |
| **Enum.5** | Keep ALL_CAPS out of enumerator names |
| **Enum.6** | Give every enumeration a name |

```cpp
// Enum.3 + Enum.5: Scoped enum, no ALL_CAPS
enum class Color { red, green, blue };
enum class LogLevel { debug, info, warning, error };

// BAD: plain enum leaks names, ALL_CAPS clashes with macros
enum { RED, GREEN, BLUE };           // Enum.3 + Enum.5 + Enum.6 violation
#define MAX_SIZE 100                  // Enum.1 violation -- use constexpr
```

## Source Files & Naming (SF.*, NL.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **SF.1** | End source file names in `.cpp` and header names in `.h` |
| **SF.7** | Keep global `using namespace` directives out of headers |
| **SF.8** | Guard every header against being included twice |
| **SF.11** | Each header should compile on its own |
| **NL.5** | Don't put a variable's type into its name (no Hungarian notation) |
| **NL.8** | Pick one naming convention and stick to it |
| **NL.9** | Reserve ALL_CAPS for macros |
| **NL.10** | Default to lowercase names with underscores (`underscore_style`) |

### Header Guard

```cpp
// SF.8: Include guard (or #pragma once)
#ifndef PROJECT_MODULE_WIDGET_H
#define PROJECT_MODULE_WIDGET_H

// SF.11: Self-contained -- include everything this header needs
#include <string>
#include <vector>

namespace project::module {

class Widget {
public:
    explicit Widget(std::string name);
    const std::string& name() const;

private:
    std::string name_;
};

}  // namespace project::module

#endif  // PROJECT_MODULE_WIDGET_H
```

### Naming Conventions

```cpp
// NL.8 + NL.10: Consistent underscore_style
namespace my_project {

constexpr int max_buffer_size = 4096;  // NL.9: not ALL_CAPS (it's not a macro)

class tcp_connection {                 // underscore_style class
public:
    void send_message(std::string_view msg);
    bool is_connected() const;

private:
    std::string host_;                 // trailing underscore for members
    int port_;
};

}  // namespace my_project
```

### Anti-Patterns

- `using namespace std;` in a header at global scope (SF.7)
- Headers that depend on inclusion order (SF.10, SF.11)
- Hungarian notation like `strName`, `iCount` (NL.5)
- ALL_CAPS for anything other than macros (NL.9)

## Performance (Per.*)

### Key Rules

| Rule | Summary |
|------|---------|
| **Per.1** | Have a concrete reason before optimizing anything |
| **Per.2** | Correctness first; tune for speed later |
| **Per.6** | Back every performance claim with a measurement |
| **Per.7** | Choose designs that leave room to optimize later |
| **Per.10** | Lean on static types so the compiler can optimize |
| **Per.11** | Compute at compile time what you can, not at run time |
| **Per.19** | Walk memory in regular, cache-friendly patterns |

### Guidelines

```cpp
// Per.11: Compile-time computation where possible
constexpr auto lookup_table = [] {
    std::array<int, 256> table{};
    for (int i = 0; i < 256; ++i) {
        table[i] = i * i;
    }
    return table;
}();

// Per.19: Prefer contiguous data for cache-friendliness
std::vector<Point> points;           // GOOD: contiguous
std::vector<std::unique_ptr<Point>> indirect_points; // BAD: pointer chasing
```

### Anti-Patterns

- Optimizing without profiling data (Per.1, Per.6)
- Choosing "clever" low-level code over clear abstractions (Per.4, Per.5)
- Ignoring data layout and cache behavior (Per.19)

## Quick Reference Checklist

Before marking C++ work complete:

- [ ] No raw `new`/`delete` -- use smart pointers or RAII (R.11)
- [ ] Objects initialized at declaration (ES.20)
- [ ] Variables are `const`/`constexpr` by default (Con.1, ES.25)
- [ ] Member functions are `const` where possible (Con.2)
- [ ] `enum class` instead of plain `enum` (Enum.3)
- [ ] `nullptr` instead of `0`/`NULL` (ES.47)
- [ ] No narrowing conversions (ES.46)
- [ ] No C-style casts (ES.48)
- [ ] Single-argument constructors are `explicit` (C.46)
- [ ] Rule of Zero or Rule of Five applied (C.20, C.21)
- [ ] Base class destructors are public virtual or protected non-virtual (C.35)
- [ ] Templates are constrained with concepts (T.10)
- [ ] No `using namespace` in headers at global scope (SF.7)
- [ ] Headers have include guards and are self-contained (SF.8, SF.11)
- [ ] Locks use RAII (`scoped_lock`/`lock_guard`) (CP.20)
- [ ] Exceptions are custom types, thrown by value, caught by reference (E.14, E.15)
- [ ] `'\n'` instead of `std::endl` (SL.io.50)
- [ ] No magic numbers (ES.45)
