import type { CuratedSamplePackSource } from "./curated-sample-packs"

export interface CuratedGitLabSamplePackSource extends CuratedSamplePackSource {
  sourceKind: "gitlab-sfz-lfs"
  gitlabProjectId: number
  gitlabSfZPath: string
  gitlabSamplePrefix: string
}

const CELESTA_PROJECT_ID = 18547990
const CELESTA_COMMIT = "934c7fd6"
const CELESTA_SFZ = "Samples/Celesta Tuned Denoised Mix.sfz"
const CELESTA_SAMPLE_PREFIX = "Samples/Tuned/Denoised Mix/"
const CELESTA_ACK = `A Sampled Celesta de Neil Bickford publica sus archivos de audio, SFZ y SF2 bajo CC0-1.0. Tloque instalará únicamente la variante Tuned + Denoised + Mix desde la revisión ${CELESTA_COMMIT} del proyecto GitLab ${CELESTA_PROJECT_ID}, resolverá Git LFS mediante la API oficial, validará cada WAV RIFF y lo copiará a App Storage con SHA-256.`

export const SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK: CuratedGitLabSamplePackSource = {
  id: "sampled-celesta-tuned-denoised-mix",
  name: "A Sampled Celesta",
  libraryName: "A Sampled Celesta",
  displayName: "Mustel Celesta · Tuned Denoised Mix",
  instrumentId: "keys.celesta",
  moduleId: "sampled-celesta-tuned-denoised-mix",
  manifestId: "sampled-celesta-tuned-denoised-mix",
  version: "gitlab-934c7fd6",
  license: "CC0-1.0",
  repositoryUrl: "https://gitlab.com/echoparallax/a-sampled-celesta",
  pinnedCommit: CELESTA_COMMIT,
  sfzPath: CELESTA_SFZ,
  sfzPaths: [CELESTA_SFZ],
  sfzSampleBasePath: "Samples",
  estimatedMegabytes: 120,
  acknowledgement: CELESTA_ACK,
  tags: ["native-samples", "celesta", "keys", "cc0", "gitlab-lfs", "tuned", "denoised", "mixed-mics", "round-robin"],
  samplePackInstall: {
    moduleId: "sampled-celesta-tuned-denoised-mix",
    manifestId: "sampled-celesta-tuned-denoised-mix",
    version: "gitlab-934c7fd6",
    pinnedCommit: CELESTA_COMMIT,
    sfzPath: CELESTA_SFZ,
    estimatedMegabytes: 120,
    acknowledgement: CELESTA_ACK,
    tags: ["native-samples", "celesta", "keys", "cc0", "gitlab-lfs", "tuned", "denoised", "mixed-mics", "round-robin"],
  },
  sourceKind: "gitlab-sfz-lfs",
  gitlabProjectId: CELESTA_PROJECT_ID,
  gitlabSfZPath: CELESTA_SFZ,
  gitlabSamplePrefix: CELESTA_SAMPLE_PREFIX,
}

export const CURATED_GITLAB_SAMPLE_PACKS = [SAMPLED_CELESTA_TUNED_DENOISED_MIX_PACK] as const

export function curatedGitLabSamplePackById(id: string | null | undefined): CuratedGitLabSamplePackSource | null {
  if (!id) return null
  return CURATED_GITLAB_SAMPLE_PACKS.find(pack => pack.id === id) ?? null
}

export function isCuratedGitLabSamplePackSource(source: CuratedSamplePackSource): source is CuratedGitLabSamplePackSource {
  return (source as Partial<CuratedGitLabSamplePackSource>).sourceKind === "gitlab-sfz-lfs"
}
