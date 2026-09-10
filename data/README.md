# data

Local corpus for the F4-L0 shape survey (T27). Real user files live here and are
never committed: the directory ignores everything but this note.

The survey measures what fraction of real over-budget documents are
record-shaped, which is the one unmeasured assumption behind
[K19-3](../docs/kararlar/019-buyuk-dosya-ve-kademe.md). If the answer is "they
are not", K19-3 reopens and the F4 gate order changes.

Nothing under `packages/*/test` may read from here; fixtures stay synthetic.
