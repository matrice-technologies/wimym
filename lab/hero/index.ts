// What the app imports. See hero/README.md.
export { Hero, default, shapesOf } from "./Hero";
export type { HeroHandle, HeroPiece, HeroProps } from "./Hero";
export { syntheticData } from "../src/shared/data";
export type { PointsPayload, RawDay, RawMessage } from "../src/shared/data";
export { makePostcard, makePostcardFilm, makePostcardPage, postcardDays, postcardFacts, postcardLines, postcardQuestion, savePostcard, savePostcardPage } from "./postcard";
export type { PostcardFormat, PostcardOptions } from "./postcard";
export type { PostcardNames } from "./postcard-day";
export { FirstRun, narration } from "./FirstRun";
export type { EngineState, FirstRunProps } from "./FirstRun";
export { mockEngineState } from "./mockState";
export { WeekForm } from "./WeekForm";
export type { WeekFormHandle, WeekFormProps } from "./WeekForm";
export { weekCaption, weekShape } from "./weekShape";
export type { WeekPayload } from "./weekShape";
