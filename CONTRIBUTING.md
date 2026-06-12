# Contributing Workflow

## Branches

- `main`: stable and runnable.
- `feature/<short-name>`: new feature work.
- `fix/<short-name>`: bug fixes.
- `docs/<short-name>`: documentation-only changes.

## Commit Messages

Use concise Conventional Commit style:

```text
type(scope): summary
```

Recommended types:

- `feat`: user-visible feature.
- `fix`: bug fix.
- `docs`: documentation.
- `test`: tests.
- `refactor`: code restructure without behavior change.
- `chore`: tooling or maintenance.

Examples:

```text
docs(repo): add project requirements and PR workflow
feat(camera): request camera permission and show preview
fix(audio): stop microphone stream when conversation ends
```

## PR Expectations

- One PR should cover one feature or fix.
- PR title should clearly state what changed.
- PR description must include feature description, implementation approach, and verification method.
- If third-party libraries are introduced, update README.
- If any previous personal code is reused, cite it in the PR description.

