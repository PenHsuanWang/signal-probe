/**
 * Factory-created Plot component.
 *
 * react-plotly.js ships as a CommonJS module. In Vite's ESM context the
 * default import becomes the module wrapper object instead of the component,
 * which causes the "Element type is invalid: got object" runtime error.
 *
 * The factory pattern bypasses this: we import plotly.js-dist-min (a
 * pre-built ESM-friendly bundle) and pass it explicitly to the factory,
 * so Vite never needs to CJS→ESM-convert plotly.js.
 */
import _createPlotlyComponent from 'react-plotly.js/factory';
import _Plotly from 'plotly.js-dist-min';

// Vite ESM interop fix: CommonJS modules might be wrapped in an object with a `default` property.
const createPlotlyComponent = (
  _createPlotlyComponent && typeof _createPlotlyComponent === 'object' && 'default' in _createPlotlyComponent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (_createPlotlyComponent as any).default
    : _createPlotlyComponent
) as typeof _createPlotlyComponent;

const Plotly = (
  _Plotly && typeof _Plotly === 'object' && 'default' in _Plotly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (_Plotly as any).default
    : _Plotly
) as typeof _Plotly;

export const Plot = createPlotlyComponent(Plotly);
