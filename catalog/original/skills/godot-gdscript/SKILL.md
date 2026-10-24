---
name: godot-gdscript
description: Godot 4.x GDScript (4.7 current) covering static typing and its speed-up, scene composition, Godot 4 signal and await syntax, resources, autoloads, _process vs _physics_process, input handling, @export annotations, Godot 3 to 4 renames, performance basics, export presets and headless CI exports, .godot/ and .uid version control, and GUT or gdUnit4 tests. Use when editing .gd, .tscn, .tres or project.godot files, porting Godot 3 code, or writing gameplay code in Godot 4.
---

# Godot 4 GDScript (Godot 4.7)

The current release is Godot 4.7 (June 2026). 4.6 also has full support, 4.5 gets security fixes only, and 4.8 is expected in Q4 2026. The project's version appears in `project.godot` as `config/features=PackedStringArray("4.7", …)`; check it before using newer features:

- **4.2:** typed `for` loop variables.
- **4.3:** `TileMapLayer` nodes replace `TileMap`; 2D physics interpolation; web exports are single-threaded by default.
- **4.4:** typed dictionaries, `.uid` files for scripts and shaders, `@export_tool_button`, 3D physics interpolation, and Jolt physics built in (experimental).
- **4.5:** `@abstract` classes and methods, variadic functions (`func sum(first: float, ...rest: Array)`), and `duplicate_deep()`.
- **4.6:** Jolt becomes the default 3D physics engine for new projects. Scenes store unique node IDs; resave them with Project > Tools > Upgrade Project Files.
- **4.7:** an override of a method with a typed return inherits that type, so it needs an explicit `return`. Mouse and keyboard events use `InputEvent.DEVICE_ID_MOUSE` and `DEVICE_ID_KEYBOARD` instead of device 0.

## Godot 3 habits to replace

| Godot 3 | Godot 4 |
|---|---|
| `onready var`, `export var`, `tool` | `@onready var`, `@export var`, `@tool` |
| `export(int, 0, 10) var x` | `@export_range(0, 10) var x: int` |
| `export(NodePath) var path`, then `get_node(path)` | `@export var target: Node2D` |
| `connect("hit", self, "_on_hit")` | `hit.connect(_on_hit)` |
| `emit_signal("hit", 5)` | `hit.emit(5)` |
| `yield(obj, "done")`, `yield(get_tree(), "idle_frame")` | `await obj.done`, `await get_tree().process_frame` |
| `var hp setget set_hp` | `var hp: int:` followed by a `set(value):` block |
| `.take_damage(n)` to call the parent | `super.take_damage(n)`, or `super()` |
| `KinematicBody2D`, `KinematicBody` | `CharacterBody2D`, `CharacterBody3D` |
| `move_and_slide(velocity, Vector2.UP)` | Set `velocity` (and `up_direction`), then call `move_and_slide()` |
| `Spatial`, `Sprite`, `Position2D`, `Particles2D` | `Node3D`, `Sprite2D`, `Marker2D`, `GPUParticles2D` |
| `scene.instance()`, `change_scene(path)` | `scene.instantiate()`, `change_scene_to_file(path)` |
| `Tween` node with `interpolate_property()` | `create_tween().tween_property(...)` |
| `File`, `Directory` | `FileAccess.open()`, `DirAccess.open()` (static; return `null` on error) |
| `rand_range`, `stepify`, `deg2rad`, `range_lerp` | `randf_range`, `snapped`, `deg_to_rad`, `remap` |
| `update()` on a CanvasItem | `queue_redraw()` |
| `rect_position`, `rect_size`, `rect_min_size` | `position`, `size`, `custom_minimum_size` |
| `BUTTON_LEFT`, `event.scancode` | `MOUSE_BUTTON_LEFT`, `event.keycode` / `physical_keycode` |
| `get_tree().set_input_as_handled()` | `get_viewport().set_input_as_handled()` |
| `OS.get_ticks_msec()`, `to_json()`, `parse_json()` | `Time.get_ticks_msec()`, `JSON.stringify()`, `JSON.parse_string()` |
| `PoolStringArray`, `Reference`, `funcref()` | `PackedStringArray`, `RefCounted`, `Callable` |
| `pause_mode`, `master`/`puppet`/`remote` | `process_mode`, `@rpc` |

## Typed GDScript

```gdscript
class_name Player
extends CharacterBody2D

signal died

@export var speed: float = 220.0
@export_range(1, 500) var max_health: int = 100

var health: Health  # a RefCounted class, so its logic is testable without a scene

@onready var _sprite: AnimatedSprite2D = %Sprite
@onready var _hurtbox: Area2D = $Hurtbox


func _ready() -> void:
	health = Health.new(max_health)  # inspector values are applied by now
	health.died.connect(_on_health_died)
	_hurtbox.area_entered.connect(_on_hurtbox_area_entered)


func _physics_process(_delta: float) -> void:
	var direction := Input.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")
	velocity = direction * speed
	move_and_slide()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"attack"):
		_sprite.play(&"attack")
		get_viewport().set_input_as_handled()


func _on_hurtbox_area_entered(area: Area2D) -> void:
	var hitbox := area as Hitbox
	if hitbox:
		health.value -= hitbox.damage


func _on_health_died() -> void:
	died.emit()
	set_physics_process(false)
	_sprite.play(&"death")
	await _sprite.animation_finished
	queue_free()
```

- **Annotate everything:** type every variable, parameter and return value, `-> void` included. `:=` infers the type, so use it when the right-hand side makes the type obvious.
- **Why it pays off:** typed code runs faster, because the VM uses optimized opcodes when types are known at compile time. Typos and wrong calls also become parse errors, and autocompletion works fully.
- **Enforcing it:** enable the `UNTYPED_DECLARATION` warning (Project Settings > Debug > GDScript, with Advanced Settings on), and raise it to Error once the project is fully typed.
- **Typed collections:** write `Array[Enemy]` and, from 4.4, `Dictionary[StringName, int]`. Nested typed collections such as `Array[Array[int]]` aren't supported.
- **Casts:** `x as Type` silently yields `null` on a mismatch. Check the result for `null`, or test with `is` first.
- **Class names:** give reusable scripts a `class_name` so other scripts can use the type. Typed loops are written `for enemy: Enemy in enemies:` (4.2+).

## Scenes, nodes and composition

- **Composition:** give each scene one responsibility, and build behaviour from child nodes and sub-scenes (Hurtbox, Health, StateMachine) rather than deep `extends` chains.
- **Call down, signal up:** a node calls methods on the children it owns and emits signals for its parent. It never reaches up with `get_parent().get_parent()`. Siblings talk through their parent or an event-bus autoload.
- **References:** cache node references once, with `@onready var x: Type = $Path` or a scene-unique `%Name`, and never call `get_node()` or `find_child()` every frame. Link across scenes with `@export var target: Node2D`, set in the inspector. Don't put `@onready` and `@export` on the same variable; the combination doesn't behave as you'd expect.
- **Lifecycle:** `_init()` runs before the node is in the tree. `_enter_tree()` runs parents first, and `_ready()` runs children first, once per node. Inspector values are assigned after member initializers run, so derive values from exports in `_ready()`, not in declarations.
- **Freeing:** free nodes with `queue_free()`. Code can resume after an `await` when other nodes are already gone, so check `is_instance_valid(node)` before using them.
- **Physics callbacks:** inside callbacks such as `body_entered`, defer changes to the tree and to collision: `add_child.call_deferred(node)`, `shape.set_deferred(&"disabled", true)`.
- **Groups:** `add_to_group(&"enemies")` and `get_tree().call_group(&"enemies", &"alert")` broadcast without hard references.

## Signals and await

```gdscript
for i in slot_buttons.size():
	slot_buttons[i].pressed.connect(_on_slot_pressed.bind(i))
$RespawnTimer.timeout.connect(_respawn, CONNECT_ONE_SHOT)
var choice: int = await dialog.closed  # yields the signal's argument
```

- **Declaring and emitting:** declare signals with typed parameters (`signal health_changed(current: int, maximum: int)`), name them in the past tense, and emit with `.emit()`.
- **Connecting:** connect a Callable with `sig.connect(method)`. Pass extra arguments with `.bind()`, and use flags such as `CONNECT_ONE_SHOT` and `CONNECT_DEFERRED`.
- **String forms are Godot 3 style:** `connect("pressed", self, "_on_pressed")` is gone. `emit_signal(&"hit")` still works, but a typo in the name is no longer caught at parse time.
- **Await:** `await sig` returns the signal's single argument, or an Array when there are several. `await some_coroutine()` waits for the coroutine to finish.
- **Lambdas:** they capture local variables by value when created. To `disconnect()` a lambda later, keep it in a variable.
- **Editor connections:** connections made in the editor are stored in the `.tscn` and break when the handler is renamed. Prefer connecting in code for gameplay logic.
- **Delays in nodes that can be freed:** a coroutine waiting on `get_tree().create_timer()` outlives its node. Wait on a child `Timer` or a node-bound `create_tween()` instead.

## Resources and autoloads

- **Data resources:** keep data in custom `Resource` classes (`class_name WeaponData extends Resource` with `@export` fields), saved as `.tres` and assigned through `@export var weapon: WeaponData`.
- **Shared instances:** `load()` and `preload()` of the same path return the same cached instance, so a runtime change shows up everywhere. Copy before changing per-instance state: `weapon = weapon.duplicate()`, or `duplicate_deep()` in 4.5+ to also copy resources nested in arrays and dictionaries. Alternatively, enable Local to Scene on the resource.
- **Loading:** `preload()` takes a constant path and loads with the script, so use it for small, always-needed assets. Use `load()` or `ResourceLoader.load_threaded_request()` for large or optional ones.
- **Autoloads:** they are nodes added under the root before the first scene (Project Settings > Globals > Autoload). Use them for cross-scene services such as saving, settings, audio and an event bus; level state belongs in the level. Don't give an autoload script a `class_name` equal to its autoload name, because the two names clash. Access it by the autoload name, and never free it.
- **Alternatives:** `static var` and `static func` (4.1+), or a shared Resource, often replace an autoload.

```gdscript
# events.gd, registered as the autoload "Events"
extends Node

signal coin_collected(value: int)
signal level_finished(level_id: StringName)
# Emit with Events.coin_collected.emit(5); listen with Events.coin_collected.connect(_on_coin_collected).
```

## Frame loop and input

- **`_physics_process(delta)`:** runs at the fixed physics tick (60 Hz by default, set in `physics/common/physics_ticks_per_second`). Move bodies, apply forces, read movement input and check `is_on_floor()` here.
- **`_process(delta)`:** runs once per rendered frame. Handle visuals, UI, camera smoothing and effects here.
- **Jitter on high-refresh displays:** enable physics interpolation (2D in 4.3+, 3D in 4.4+). Don't move bodies in `_process()`.
- **Idle and pause:** stop unused callbacks with `set_process(false)` or `set_physics_process(false)`. Pause menus use `process_mode = PROCESS_MODE_ALWAYS`.
- **Input:** take actions from the Input Map and never hard-code keys. Poll continuous input (`Input.get_vector()`, `Input.is_action_pressed()`) in `_physics_process()`. Handle one-off presses in `_unhandled_input()`, so UI controls see the event first, and consume it with `get_viewport().set_input_as_handled()`.

## @export annotations

```gdscript
@export_group("Movement")
@export var speed := 220.0
@export_range(0.0, 4000.0, 10.0, "suffix:px/s²") var acceleration := 1200.0
@export_group("Combat")
@export var weapon: WeaponData
@export var loot_table: Array[ItemData] = []  # typed Resource array, filled by dragging .tres files
@export_enum("Idle", "Patrol", "Chase") var start_state: int = 0
@export_file("*.json") var dialogue_path: String
@export_flags_2d_physics var hit_layers: int
```

- **Saved overrides:** a value edited in the inspector is saved in the scene and wins over the script default. Changing the default later affects only instances that never overrode it.
- **Node references:** exported node references replace Godot 3's exported `NodePath` plus `get_node()`.
- **Editor tools:** `@export_tool_button` (4.4+) turns a `Callable` property into an inspector button in `@tool` scripts. Guard editor-only code with `Engine.is_editor_hint()`.

## Performance basics

- **Profile first:** use the Debugger's Profiler, Visual Profiler and Monitors before optimizing.
- **Per-frame code:** keep it statically typed and use cached node references, with no `get_node()` calls or group lookups.
- **Many nodes:** thousands of nodes that each run `_process()` cost more than one manager looping over a typed array. Disable processing off-screen with `VisibleOnScreenEnabler2D/3D`.
- **Many objects:** draw many identical objects with `MultiMeshInstance2D/3D`. If instantiation shows up in the profiler (bullets, for example), reuse instances instead of creating and freeing them every frame.
- **Physics:** use collision layers and masks and simple shapes, and react to signals (`body_entered`) rather than polling overlaps every frame.
- **Rendering methods:** Forward+ (desktop), Mobile, or Compatibility, which web exports require (WebGL 2). C# projects can't export to the web in Godot 4.
- **Logging:** `print()` in hot paths is slow. Keep debug output behind `OS.is_debug_build()`.

## Export presets and headless CI

```bash
godot --headless --path . --import   # rebuild the .godot/ cache, which is not in git
godot --headless --path . --export-release "Windows Desktop" build/windows/game.exe
```

- **Credentials:** since 4.1, `export_presets.cfg` is safe to commit. Passwords and encryption keys live in `.godot/export_credentials.cfg`, which stays out of git, so CI must recreate them from secrets.
- **Templates and presets:** export templates must match the editor version exactly, and the preset name must exist in `export_presets.cfg`. Relative output paths resolve from the project folder.
- **Web exports:** they are single-threaded by default (4.3+) and need no special headers. Enabling threads requires cross-origin isolation (COOP/COEP headers).

## Version control

- **Generated metadata:** let the editor create it, either with Project > Version Control > Generate Version Control Metadata or with the Git option when creating a project. The `.gitignore` excludes `.godot/`, and the `.gitattributes` enforces LF line endings.
- **What to commit:** `project.godot`, `export_presets.cfg`, every `*.import` file (import settings) and every `*.uid` file (4.4+, resource IDs for scripts and shaders). Move and rename files in Godot's FileSystem dock so that references and `.uid` files follow.
- **Text formats:** keep scenes and resources as text (`.tscn`, `.tres`) so they diff and merge; small scenes conflict less. Large binary assets go in Git LFS, set up before those files are first committed.
- **Engine upgrades:** upgrade the engine in its own commit, including Project > Tools > Upgrade Project Files, separate from feature work.

## Testing: GUT or gdUnit4

| | GUT 9.x | gdUnit4 6.x |
|---|---|---|
| Test style | `extends GutTest`, `assert_eq(got, expected)` | `extends GdUnitTestSuite`, fluent `assert_int(x).is_equal(5)` |
| Strengths | Simple and mature: doubles, stubs, signal asserts | Scene runner that simulates input and frames, C# support, HTML and JUnit reports |
| CLI | `godot --headless -d -s --path . addons/gut/gut_cmdln.gd -gdir=res://test -gexit` | `addons/gdUnit4/runtest.sh -a <test dir>`, with `GODOT_BIN` set |

```gdscript
extends GutTest  # tests Health: RefCounted, with `signal died`, `max_value` and a clamping `value` setter

func test_damage_clamps_at_zero() -> void:
	var health := Health.new(10)
	health.value -= 25
	assert_eq(health.value, 0)

func test_died_emitted_once() -> void:
	var health := Health.new(10)
	watch_signals(health)
	health.value -= 25
	health.value -= 5
	assert_signal_emit_count(health.died, 1)
```

- **Versions:** pick the addon release that matches the engine's minor version; both projects publish per-minor compatibility.
- **What to test:** test logic in plain classes (`RefCounted`, `Resource`) without scenes, and keep scene tests few.
- **CI:** run `godot --headless --import` before the tests so that global `class_name` types resolve. GUT exits with 1 on failure, and `-gjunit_xml_file=` writes a JUnit report.
- **Cleanup:** free what tests create, using `autofree()` and `add_child_autofree()` in GUT or `auto_free()` in gdUnit4, to avoid orphan-node warnings.

## Style

- **Style guide:** follow the official GDScript style guide. Indent with tabs. Use `snake_case` for files, functions and variables, `PascalCase` for `class_name` and node names, and `CONSTANT_CASE` for constants. Prefix private members with `_`, and name signals in the past tense.
- **Member order:** signals, enums, constants, `@export` vars, other vars, `@onready` vars, built-in callbacks, then methods.
- **Optional tooling:** gdtoolkit (`pip install "gdtoolkit==4.*"`) adds `gdformat` and `gdlint` for CI.

## Review checklist

- [ ] The code uses only Godot 4 syntax: annotations, `sig.connect(callable)`, `sig.emit()`, `await`, `super` and Godot 4 class names.
- [ ] Every variable, parameter and return value is typed, collections are typed, and every `as` cast is checked for `null`.
- [ ] Node references come from `@onready`, `%Name` or `@export`, and there are no `get_parent()` chains.
- [ ] Movement and physics run in `_physics_process()`, and input comes from Input Map actions and `_unhandled_input()`.
- [ ] Shared resources are duplicated before per-instance changes, and autoloads hold only cross-scene services.
- [ ] Changes made in physics callbacks are deferred, nodes are freed with `queue_free()`, and validity is checked after `await`.
- [ ] `.godot/` is ignored, `.import`, `.uid`, `project.godot` and `export_presets.cfg` are committed, and no credentials are in git.
- [ ] Tests run headless in CI after `--import`.

<!-- Written for legacies (MIT). Checked against: https://docs.godotengine.org/en/stable/about/release_policy.html, https://godotengine.org/releases/4.7/, https://godotengine.org/releases/4.6/, https://godotengine.org/releases/4.5/, https://godotengine.org/releases/4.4/, https://docs.godotengine.org/en/stable/tutorials/migrating/upgrading_to_godot_4.7.html, https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html, https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html, https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_exports.html, https://docs.godotengine.org/en/stable/tutorials/scripting/singletons_autoload.html, https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html, https://docs.godotengine.org/en/stable/tutorials/best_practices/version_control_systems.html, https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html, https://godotengine.org/article/uid-changes-coming-to-godot-4-4/, https://gut.readthedocs.io/en/latest/class_ref/class_guttest.html, https://godot-gdunit-labs.github.io/gdUnit4/latest/advanced_testing/cmd/, 2026-10 -->
