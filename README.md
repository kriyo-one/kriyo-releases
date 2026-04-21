# Kriyo Releases

This repository hosts public Kriyo release artifacts, release notes, checksums,
and update metadata. It does not contain Kriyo source code.

## Preview Release Flow

The private source repository builds and stages artifacts into `_incoming/`.
This repository publishes those staged artifacts:

```bash
just preflight preview 0.0.1
just publish preview 0.0.1
just verify preview 0.0.1
```

The public update feed is:

```text
https://updates.kriyo.one/kriyo/preview/latest.json
```

GitHub Release tags use:

```text
kriyo-preview-v<version>
```

Release assets are uploaded to GitHub Releases. DMGs are not committed to this
repository.
