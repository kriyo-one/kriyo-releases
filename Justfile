set shell := ["bash", "-euo", "pipefail", "-c"]

repo_slug := env_var_or_default("KRIYO_RELEASE_REPO_SLUG", "kriyo-one/kriyo-releases")
pages_domain := env_var_or_default("KRIYO_RELEASE_PAGES_DOMAIN", "updates.kriyo.one")

default:
  just --list

preflight channel version:
  node scripts/release-repo.mjs preflight "{{channel}}" "{{version}}" --repo "{{repo_slug}}" --pages-domain "{{pages_domain}}"

publish channel version: (preflight channel version)
  node scripts/release-repo.mjs publish "{{channel}}" "{{version}}" --repo "{{repo_slug}}" --pages-domain "{{pages_domain}}"

verify channel version:
  node scripts/release-repo.mjs verify "{{channel}}" "{{version}}" --repo "{{repo_slug}}" --pages-domain "{{pages_domain}}"
