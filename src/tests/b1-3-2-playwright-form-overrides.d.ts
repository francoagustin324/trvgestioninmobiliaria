// Playwright infiere Locator.evaluate como HTMLElement | SVGElement aunque el selector sea un formulario.
// El escenario B1.3.2 comprueba el nodo en runtime mediante el selector #mvp-lead-form antes de invocar requestSubmit.
interface HTMLElement {
  requestSubmit(submitter?: HTMLElement | null): void;
}

interface SVGElement {
  requestSubmit(submitter?: HTMLElement | null): void;
}
