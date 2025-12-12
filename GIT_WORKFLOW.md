# Git Workflow – Daily Checklist & Branch Naming

This doc describes **how we work with branches, commits, and PRs** so changes can be safely merged into `main` and deployed to **TSS** and **FRK** in lock step.

---

## 0. Branch Naming Conventions

All work must be done on short-lived branches, never directly on `main`.

Use these prefixes:

- `feat/` – new feature  
  - e.g. `feat/rma-history-endpoint`
- `fix/` – bug fix (non-urgent)  
  - e.g. `fix/l10-timezone-offset`
- `hotfix/` – critical production fix (breakage, P0 issues)  
  - e.g. `hotfix/broken-login-500`
- `chore/` – non-functional / cleanup / tooling  
  - e.g. `chore/update-eslint-config`
- `docs/` – documentation changes only  
  - e.g. `docs/add-git-workflow`
- `refactor/` – internal restructuring, no behavior changes  
  - e.g. `refactor/pallet-service-layer`
- `test/` – experiments, spikes, or throwaway testing  
  - e.g. `test/new-chart-lib-spike`

General rules:

- Use **kebab-case** for the short name: `words-separated-by-dashes`
- Keep it short but descriptive
- Single purpose per branch (one feature or one fix)

Examples:

```text
feat/add-rma-pallet-history
fix/export-csv-timezone-bug
hotfix/fix-prod-deploy-script
chore/cleanup-old-l10-scripts
docs/update-readme-for-new-flow
refactor/split-pallet-routes
test/experiment-react-query
```

---

## 1. Start from an up-to-date `main`

Before creating any branch, make sure your local `main` matches the remote:

```bash
git checkout main
git pull origin main
```

This reduces conflicts and keeps branches small and focused.

---

## 2. Create a new branch for your work

Pick the correct prefix and create a branch from `main`.

### New feature

```bash
git checkout main
git pull origin main
git checkout -b feat/<short-name>
```

Example:

```bash
git checkout -b feat/rma-history-endpoint
```

### Bug fix

```bash
git checkout main
git pull origin main
git checkout -b fix/<short-name>
```

Example:

```bash
git checkout -b fix/l10-api-timeout
```

### Critical production hotfix

For urgent production issues, use `hotfix/`:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/<short-name>
```

Example:

```bash
git checkout -b hotfix/bad-nginx-proxy-rules
```

### Chores, docs, refactors, tests

Same pattern:

```bash
git checkout main
git pull origin main
git checkout -b chore/cleanup-old-label-code
git checkout -b docs/add-l10-test-doc
git checkout -b refactor/split-part-routes
git checkout -b test/new-pdf-lib-spike
```

---

## 3. Do the work and commit

Make your changes locally and commit them in logical chunks.

```bash
# See what changed
git status

# Stage files
git add path/to/file1 path/to/file2
# or just all modified files (careful):
git add .
```

Write a **clear commit message**:

```bash
git commit -m "Short imperative description of what you changed"
```

Examples:

```bash
git commit -m "Add endpoint for pallet history with RMA details"
git commit -m "Fix L10 test script timeout handling"
git commit -m "Refactor pallet controller into service layer"
git commit -m "Update README with Git workflow"
```

You can repeat `add` + `commit` as many times as needed while working on the same branch.

---

## 4. Push the branch to the remote

Push your branch for the first time:

```bash
git push -u origin feat/<short-name>
# or
git push -u origin fix/<short-name>
# or
git push -u origin hotfix/<short-name>
```

The `-u` flag sets the upstream tracking branch so later you can just run:

```bash
git push
```

without extra arguments.

---

## 5. Open a Pull Request (PR) into `main`

Once the branch is pushed:

1. Go to the repo on GitHub.
2. You should see a **“Compare & pull request”** banner for your branch. Click it.  
   (Or click **New pull request** and set:
   - **Base**: `main`
   - **Compare**: your branch, e.g. `feat/rma-history-endpoint`)
3. Fill in the PR details:

### PR Title

Follow this pattern:

```text
<type>: <short description>

# examples
feat: add RMA history endpoint
fix: correct L10 timezone bug
hotfix: fix production deploy script
docs: add Git workflow guide
```

### PR Description (Example Template)

```markdown
## Summary
- Briefly describe what this PR does

## Type
- [x] Feature
- [ ] Bug fix
- [ ] Hotfix
- [ ] Chore
- [ ] Docs
- [ ] Refactor
- [ ] Test/Experiment

## Testing
- [x] Local tests passed
- [ ] Manually tested on dev/stage
- Notes: how to reproduce / verify

## Deployment
- Any DB migrations?
- Any config changes (env vars, secrets, scripts)?
- Safe to deploy to TSS and FRK in lock step.
```

4. Submit the PR and request review.

---

## 6. Review, squash merge, and deploy

1. **Code review**  
   - Another team member (or the repo owner) reviews the PR.
   - All comments should be resolved before merge.
2. **Merge strategy**  
   - Use **“Squash and merge”** so the branch becomes a single clean commit on `main`.
3. **Sync local `main` after merge**

   ```bash
   git checkout main
   git pull origin main
   ```


---

## 7. Clean up local and remote branches

After the PR is merged:

- On GitHub: click **“Delete branch”** when prompted.
- Locally:

```bash
git checkout main
git pull origin main
git branch -d feat/<short-name>      # or fix/<…>, hotfix/<…>, etc.
```

If the branch wasn’t fully merged and you still want to delete it:

```bash
git branch -D feat/<short-name>
```

(Use `-D` with care—it forces deletion.)

---

## Quick Reference – “What do I do when I start work?”

```bash
# 1. Start from main
git checkout main
git pull origin main

# 2. Create a branch with the correct prefix
git checkout -b feat/<short-name>    # new feature
# or
git checkout -b fix/<short-name>     # bug fix
# or
git checkout -b hotfix/<short-name>  # critical prod fix
# etc.

# 3. Work, then commit and push
git add .
git commit -m "Clear message of what changed"
git push -u origin feat/<short-name>

# 4. Open a PR to main
#    - Get review
#    - Squash and merge when approved

# 5. After merge
git checkout main
git pull origin main

```
