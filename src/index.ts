import type { CircularLayoutOptions } from 'layout-circular';
import type { Diagram, FlowchartModel } from 'pele';
import { renderCircular } from './render.js';

export type { CircularLayoutOptions } from 'layout-circular';

/** The layout names a diagram can ask for in its config. */
const NAMES = new Set(['circular', 'circular-ccw']);

/**
 * Pele's flowchart diagram with the circular layout added. A flowchart
 * whose config says `layout: circular` (or `circular-ccw`) is placed on
 * a circle; every other flowchart renders exactly as Pele renders it.
 *
 * ```ts
 * import { register } from 'pele';
 * import flowchart from 'pele/diagrams/flowchart';
 * import { withCircularLayout } from 'pele-layout-circular';
 *
 * register(withCircularLayout(flowchart));
 * ```
 */
export const withCircularLayout = <Model extends FlowchartModel>(
  flowchart: Diagram<Model>,
  options: CircularLayoutOptions = {}
): Diagram<Model> => ({
  ...flowchart,
  render(model, config, renderOptions) {
    const name = config.layout;
    if (typeof name !== 'string' || !NAMES.has(name)) {
      return flowchart.render(model, config, renderOptions);
    }
    // Pele lays the diagram out first, at full size: a narrow width
    // would turn it or wrap its labels, and only its drawing is kept.
    const base = flowchart.render(model, config, {
      ...renderOptions,
      maxWidth: undefined,
      autoDirection: false,
    });
    const flow = config.flowchart;
    const flowConfig =
      typeof flow === 'object' && flow !== null && !Array.isArray(flow) ? (flow as Record<string, unknown>) : {};
    const nodeSpacing = flowConfig.nodeSpacing;
    return renderCircular(
      model,
      base,
      {
        ...(typeof nodeSpacing === 'number' && { spacing: nodeSpacing }),
        // Pele's arrowhead is ARROW = 8 long and 0.42 of that wide on
        // each side of its line (`marker` in Pele's `svg/edges.ts`), so
        // an 8px gap clears the sibling line by about 4px. The core's
        // default is sized for mermaid's larger heads.
        parallelGap: 8,
        ...options,
        // The diagram picked circular-ccw by name in its own config, the
        // most local signal there is, so it outranks options set in code.
        ...(name === 'circular-ccw' && { direction: 'counterclockwise' as const }),
        // `curve` already means edge shape, so a linear curve draws
        // straight edges. Every other curve keeps the arcs.
        ...(flowConfig.curve === 'linear' && { edges: 'straight' as const }),
      },
      renderOptions,
      titleWidth(flowchart, model, config, renderOptions)
    );
  },
});

/** The width Pele gives a title: an empty flowchart that has only the
 *  title is drawn exactly that wide. */
const titleWidth = <Model extends FlowchartModel>(
  flowchart: Diagram<Model>,
  model: Model,
  config: Parameters<Diagram<Model>['render']>[1],
  options: Parameters<Diagram<Model>['render']>[2]
): number => {
  if (!model.title) return 0;
  const empty = flowchart.parse('flowchart TB\n', config, model.title, 0, { maxEdges: 0 });
  return flowchart.render(empty, config, { ...options, maxWidth: undefined, autoDirection: false }).width;
};
