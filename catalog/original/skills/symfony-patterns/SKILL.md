---
name: symfony-patterns
description: Symfony 7.4 LTS application patterns, also valid on 8.x, covering the bundle-less src/ layout, autowiring and autoconfigure, routing and validation attributes, MapRequestPayload, Doctrine ORM 3 entities, repositories, migrations, N+1 and flush semantics, forms, security firewalls and voters, Messenger, env vars and secrets, console commands, and PHPUnit/WebTestCase tests. Use when composer.json requires symfony/framework-bundle, or when editing config/packages/*.yaml, src/Controller, src/Entity, bin/console commands or Symfony tests.
---

# Symfony 7.4 patterns

Symfony 7.4 is the current LTS (Nov 2025; bug fixes until Nov 2028; PHP ≥8.2). Symfony 8.0 and 8.1 need PHP ≥8.4 and are 7.4 with its deprecated APIs removed, so code that is deprecation-free on 7.4 runs on 8.x. Doctrine ORM 3.x (3.7) is current. General PHP style (PSR-12, strict types, PHPStan) is not repeated here.

## Deprecated in 7.x, removed in 8.0: don't generate these

| Don't write | Write |
|---|---|
| XML config, fluent PHP config builders (deprecated 7.4) | YAML (still the default), or array-shaped PHP `return App::config([...])` with generated `config/reference.php` |
| `$request->get('x')` | `$request->query->get('x')` (or `->request`, `->attributes`) |
| `new Assert\Length(['min' => 3])` (deprecated 7.3) | `new Assert\Length(min: 3)` / `#[Assert\Length(min: 3)]` |
| `use Symfony\Component\Routing\Annotation\Route` | `use Symfony\Component\Routing\Attribute\Route` |
| `#[TaggedIterator]`, `#[TaggedLocator]` | `#[AutowireIterator]`, `#[AutowireLocator]` |
| `doctrine.orm.controller_resolver.auto_mapping` (all wildcards → entity fields) | `{id}`, mapped params `{slug:post}` (7.1+) or `#[MapEntity]` |
| `protected static $defaultName`, `getDefaultName()` | `#[AsCommand('app:name')]` |
| `@ORM\Column` annotations, YAML mapping (removed in ORM 3) | `#[ORM\Column]` attributes |
| `$em->flush($entity)`, `$em->merge()`, `$em->clear(Foo::class)`, `Query::iterate()` | `flush()`, re-fetch, `clear()`, `toIterable()` |
| `UserInterface::eraseCredentials()` (removed 8.0) | keep no plaintext secrets on the user; control serialization with `__serialize()` |

## Layout and services

```
config/packages/*.yaml  config/routes.yaml  config/services.yaml  migrations/
src/Controller  src/Entity  src/Repository  src/Message  src/MessageHandler
src/Security/Voter  src/Command  src/Form  templates/  tests/  .env  .env.test
```

- **Bundle-less.** Application code lives in `src/` under the `App\` namespace; there is no `AppBundle`. Bundles are only for reusable packages, and Flex recipes install and configure them.
- **Autowiring.** Every class in `src/` (minus excluded paths such as `Entity/`) is a service, autowired by type. Autoconfigure tags it from its interface or attribute: `#[AsCommand]`, `#[AsMessageHandler]`, `#[AsEventListener]`, voters, form types, Twig extensions.
- **Injection.** Use constructor injection with `private readonly` properties. Never pull services from the container (`$container->get()`) in app code. Depend on the narrowest interface.
- **Scalars and named services**
  - `#[Autowire(env: 'PAYMENT_URL')]`, `#[Autowire(env: 'bool:FEATURE_X')]`, `#[Autowire(param: 'kernel.project_dir')]`, `#[Autowire(service: 'monolog.logger.payment')]`.
  - When several services implement one interface, give the default an alias with `#[AsAlias]` and pick the others with `#[Target('name')]`.
  - Plugin sets: put `#[AutoconfigureTag('app.exporter')]` on the interface and inject `#[AutowireIterator('app.exporter')] iterable $exporters`.
- **Diagnose wiring** with `bin/console debug:autowiring Mailer`, `debug:container 'App\Service\Mailer'`, `lint:container` and `debug:config framework`.

## Controllers, routing and input

```php
#[Route('/api/posts', name: 'api_post_')]
final class PostController extends AbstractController
{
    #[Route('', name: 'create', methods: ['POST'])]
    public function create(#[MapRequestPayload] CreatePost $input, #[CurrentUser] User $user, PostService $posts): JsonResponse
    {
        $post = $posts->create($input, $user);
        return $this->json(['id' => $post->getId()], Response::HTTP_CREATED);
    }

    #[Route('/{id}', name: 'show', requirements: ['id' => Requirement::DIGITS], methods: ['GET'])]
    #[IsGranted('view', 'post')]                       // 2nd arg = controller argument passed to voters
    public function show(Post $post): JsonResponse     // {id} -> find($id); 404 when missing
    {
        return $this->json($post, context: ['groups' => ['post:read']]);
    }
}

final class CreatePost
{
    public function __construct(
        #[Assert\NotBlank, Assert\Length(max: 200)] public readonly string $title,
        #[Assert\NotBlank] public readonly string $body,
    ) {}
}
```

- `#[MapRequestPayload]` deserializes and validates the body and answers 422 with violations on failure. Use `#[MapQueryString]` for query DTOs and `#[MapQueryParameter] int $page = 1` for single values. These need `symfony/serializer` and `symfony/validator`.
- Prefer `#[CurrentUser] User $user` over `$this->getUser()` plus `instanceof` checks.
- Serialize entities only through serializer groups or DTOs. `$this->json($entity)` without groups walks lazy proxies and relations and leaks fields.
- Route by explicit name. `debug:router` lists routes in match order, and `router:match /path` explains why a URL hits a controller.

## Doctrine ORM 3

```php
#[ORM\Entity(repositoryClass: PostRepository::class)]
class Post
{
    #[ORM\Id, ORM\GeneratedValue, ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 200)]
    private string $title;

    #[ORM\ManyToOne(inversedBy: 'posts')]
    #[ORM\JoinColumn(nullable: false)]
    private User $author;

    /** @var Collection<int, Comment> */
    #[ORM\OneToMany(targetEntity: Comment::class, mappedBy: 'post', orphanRemoval: true)]
    private Collection $comments;

    public function __construct(string $title, User $author)
    {
        $this->title = $title;
        $this->author = $author;
        $this->comments = new ArrayCollection();
    }

    public function addComment(Comment $comment): void      // keep both sides in sync
    {
        if (!$this->comments->contains($comment)) {
            $this->comments->add($comment);
            $comment->setPost($this);
        }
    }
}
```

- **The owning side wins.** Doctrine writes the owning side only: the `ManyToOne` side, the one with the join column. Adding to the inverse collection alone persists nothing, so adder and remover methods must update both sides.
- **persist and flush.** `persist()` is only for new objects. Managed entities are change-tracked, and `flush()` writes the whole unit of work. Flush once at the end of the use case (controller, handler or service), never per item inside a loop.
- **Transactions.** Wrap multi-step writes in `$em->wrapInTransaction(fn () => ...)`.
- **A failed flush closes the EntityManager.** Long-running code must get a fresh one with `ManagerRegistry::resetManager()` instead of reusing the closed manager.
- **Batch jobs.** Iterate with `toIterable()`, and every N rows call `flush()` then `clear()`. Re-fetch any references you still need after `clear()`.
- **Repositories** extend `ServiceEntityRepository` and hold the queries. Use QueryBuilder/DQL with `setParameter()`, never string concatenation.
- **N+1** comes from lazy collections touched in loops, Twig or the serializer.
  - Fetch-join in the repository: `->leftJoin('p.author', 'a')->addSelect('a')`.
  - Paginate fetch-joined collections with `Doctrine\ORM\Tools\Pagination\Paginator`, never a raw `setMaxResults()`.
  - Use `fetch: 'EXTRA_LAZY'` for collections you only count or test membership on. Avoid `fetch: 'EAGER'` on collections.
  - The profiler's Doctrine panel flags repeated queries.
- **Migrations.** Run `bin/console make:migration` (or `doctrine:migrations:diff`), review the SQL, commit the file, and run `doctrine:migrations:migrate --no-interaction` in the deploy. Run `doctrine:schema:validate` in CI. Never run `doctrine:schema:update --force` against a shared database.

## Forms

- The standard flow is `createForm(PostType::class, $post)`, then `handleRequest($request)`, then `if ($form->isSubmitted() && $form->isValid())` → flush → `redirectToRoute()`. Render with `['form' => $form]` and no `createView()`. Passing the form object lets `render()` answer 422 for an invalid submission, which Turbo needs.
- Forms carry a CSRF token automatically once `symfony/security-csrf` is installed, as it is in Flex apps; since 7.2 Flex configures stateless tokens. Keep `enable_csrf: true` on `form_login`. Disable CSRF per form only for token-authenticated endpoints.
- Validation constraints live on the entity or DTO, not in the form type. Bind the form to a DTO when the entity enforces invariants through its constructor.
- JSON APIs use `#[MapRequestPayload]` instead of forms.

## Security

```yaml
# config/packages/security.yaml
security:
    password_hashers:
        Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface: auto
    providers:
        users: { entity: { class: App\Entity\User, property: email } }
    firewalls:
        dev: { pattern: ^/(_profiler|_wdt|assets)/, security: false }
        api: { pattern: ^/api, stateless: true, access_token: { token_handler: App\Security\ApiTokenHandler } }
        main:
            lazy: true
            provider: users
            form_login: { login_path: app_login, check_path: app_login, enable_csrf: true }
            logout: { path: app_logout }
            login_throttling: { max_attempts: 5 }     # needs symfony/rate-limiter
    access_control:
        - { path: ^/admin, roles: ROLE_ADMIN }
```

- **Firewalls** are matched by `pattern` in order, and the first match wins. A firewall without a pattern catches everything, so it goes last.
- **`access_control`** is also first-match and handles coarse URL rules only. Object-level rules belong in voters, called through `#[IsGranted('edit', 'post')]` or `$this->denyAccessUnlessGranted(PostVoter::EDIT, $post)`, never through ID comparisons in controllers.
- **Voters**
  - Extend `Voter` and implement `supports()` plus `voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null)`. The `$vote` argument (7.3+) records reasons.
  - The default strategy is `affirmative`, where one grant wins. A voter must therefore abstain (`supports()` returns `false`) for attributes and subjects it does not own.
- **Passwords.** Hash with `auto` and rehash on login through `PasswordUpgraderInterface` on the user repository.
- **Stateless APIs** use `access_token` (or a JWT bundle), with no session and no CSRF. Don't reveal whether an account exists (`expose_security_errors`, the 7.3 replacement for `hide_user_not_found`).

## Messenger

- **Messages.** Keep them small and immutable, carrying IDs and never entities. A handler is a class with `#[AsMessageHandler]` and `__invoke(PublishPost $msg)` that re-fetches what it needs.
- **Routing.** Route in `messenger.yaml` under `routing:`, or with `#[AsMessage('async')]` (7.2+); the config wins. Unrouted messages are handled synchronously, in-request.
- **Retries.** Defaults are 3 retries with exponential delay, then the `failure_transport`, so handlers must be idempotent. Throw `UnrecoverableMessageHandlingException` for permanent failures. Inspect with `messenger:failed:show` and `messenger:failed:retry`.
- **Workers.** Run `messenger:consume async --time-limit=3600 --memory-limit=256M` under Supervisor or systemd, and run `messenger:stop-workers` after every deploy.
  - Services are reset between messages unless you pass `--no-reset`, and DoctrineBundle clears the EntityManager after each message.
  - Add the `doctrine_ping_connection` middleware for long-lived workers.
- **Follow-up events.** Dispatch them with `DispatchAfterCurrentBusStamp` so they run only if the current handler succeeds. The `doctrine_transaction` middleware wraps all handlers in one transaction.

## Config, env vars and the console

- **Load order.** `.env` (committed defaults) → `.env.local` (uncommitted; skipped in `test`) → `.env.<env>` → `.env.<env>.local`. Real environment variables beat all of them. Reference a value as `%env(NAME)%`, with processors like `%env(int:MAX_ITEMS)%`, `bool:`, `json:` and `resolve:`.
- **Secrets vault**
  - `bin/console secrets:set STRIPE_KEY` writes to the dev vault; prefix it with `APP_RUNTIME_ENV=prod` for the prod vault.
  - Commit `config/secrets/prod/*` except `prod.decrypt.private.php`. Deliver that file, or `SYMFONY_DECRYPTION_SECRET`, to production separately.
  - A real env var with the same name overrides the secret.
- **Per-environment config** goes in `when@prod:` blocks or `config/packages/prod/`.
- **Deploy:** `composer install --no-dev -o`, then `composer dump-env prod`, `APP_ENV=prod APP_DEBUG=0`, `cache:clear`, the migrations, and `messenger:stop-workers`.
- **Commands** are invokable since 7.3; extending `Command` is optional. Parameter names become kebab-case (`$dryRun` → `--dry-run`).

```php
#[AsCommand('app:users:deactivate', 'Deactivate users idle for N days')]
final class DeactivateUsersCommand
{
    public function __construct(private readonly UserRepository $users) {}

    public function __invoke(SymfonyStyle $io, #[Argument] int $days, #[Option] bool $dryRun = false): int
    {
        $count = $this->users->deactivateIdle($days, $dryRun);
        $io->success(sprintf('%d users deactivated', $count));
        return Command::SUCCESS;
    }
}
```

## Testing

```php
final class PostApiTest extends WebTestCase
{
    public function testAuthorCanCreatePost(): void
    {
        $client = static::createClient();                     // boots the kernel; call before getContainer()
        $user = static::getContainer()->get(UserRepository::class)->findOneBy(['email' => 'ann@example.com']);
        $client->loginUser($user);                             // session firewalls only; stateless: send the token
        $client->jsonRequest('POST', '/api/posts', ['title' => 'Hi', 'body' => 'First']);
        self::assertResponseStatusCodeSame(201);
    }
}
```

- **Test types.** Unit tests use plain `TestCase`. Service tests use `KernelTestCase` with `static::getContainer()`, where private services are reachable. HTTP tests use `WebTestCase`.
- **Running.** Install `composer require --dev symfony/test-pack` and run `php bin/phpunit` (configured by `phpunit.dist.xml`). PHPUnit 12 removed docblock metadata, so use attributes such as `#[DataProvider('cases')]`.
- **Database.** Use a separate test database (the recipe adds a `_test` suffix). DAMADoctrineTestBundle rolls back each test. Load data with factories (Foundry) or fixtures, and assert on the database state, not just the response.
- **Kernel reboots.** The kernel reboots between requests in one test, so entities fetched earlier become detached. Re-fetch them after each request.
- **Messenger.** Route to `in-memory://` in `when@test` and assert on `getSent()`, or use `sync://` to run handlers inline.

## Review checklist

- [ ] No deprecation notices in the profiler, the logs or the PHPUnit run (`debug:container --deprecations` covers container-time ones). The code would run on 8.x.
- [ ] Services use constructor injection only, with no container access or static state. Scalars arrive via `#[Autowire]`.
- [ ] Input enters through `#[MapRequestPayload]`/forms with constraints on DTOs. Output goes through groups or DTOs.
- [ ] Both sides of each association are synced, there is one `flush()` per use case, there are no queries in loops, and fetch joins are in place where lists render relations.
- [ ] Each migration was generated, reviewed and committed, and `doctrine:schema:validate` is clean.
- [ ] Firewalls are in the right order, `access_control` is coarse, and object checks are in voters that abstain on foreign subjects.
- [ ] Messages carry IDs, handlers are idempotent, workers have limits and are restarted on deploy.
- [ ] No secret is in `.env` or the repo; prod secrets live in the vault or real env vars, and the decrypt key is not committed.
- [ ] `php bin/phpunit` passes, tests isolate the database, and no annotations are used for PHPUnit metadata.

<!-- Written for legacies (MIT). Checked against: https://symfony.com/releases https://symfony.com/blog/symfony-7-4-curated-new-features https://github.com/symfony/symfony/blob/8.0/UPGRADE-8.0.md https://symfony.com/blog/new-in-symfony-7-4-request-class-improvements https://symfony.com/blog/new-in-symfony-7-4-better-php-configuration https://symfony.com/doc/7.4/routing.html https://symfony.com/doc/7.4/service_container/autowiring.html https://symfony.com/doc/7.4/doctrine.html https://symfony.com/doc/7.4/security/voters.html https://symfony.com/doc/7.4/messenger.html https://symfony.com/doc/7.4/console.html https://symfony.com/doc/7.4/console/input.html https://symfony.com/doc/7.4/configuration.html https://symfony.com/doc/7.4/configuration/secrets.html https://symfony.com/doc/7.4/testing.html https://www.doctrine-project.org/projects/orm.html https://github.com/doctrine/orm/blob/3.7.x/UPGRADE.md https://phpunit.de/announcements/phpunit-12.html, 2026-10 -->
