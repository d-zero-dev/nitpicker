import { describe, it, expect } from 'vitest';

import { detectSlotsFromJsx } from './detect-slots-from-jsx.js';

describe('detectSlotsFromJsx', () => {
	it('returns null for component with no JSX return', () => {
		const source = `const Noop = () => null;`;
		expect(detectSlotsFromJsx(source)).toBeNull();
	});

	it('returns null for self-closing root element (arrow function)', () => {
		const source = `const Icon = (props) => <img {...props} />;`;
		expect(detectSlotsFromJsx(source)).toBeNull();
	});

	it('returns null for self-closing root element (function declaration)', () => {
		const source = `
			function Icon(props) {
				return <img src={props.src} />;
			}
		`;
		expect(detectSlotsFromJsx(source)).toBeNull();
	});

	it('returns null for void root element', () => {
		const source = `const Divider = () => <hr>;`;
		expect(detectSlotsFromJsx(source)).toBeNull();
	});

	it('returns null when no children usage is found', () => {
		const source = `
			const Static = () => (
				<div>
					<h1>Hello</h1>
					<p>World</p>
				</div>
			);
		`;
		expect(detectSlotsFromJsx(source)).toBeNull();
	});

	it('returns true for children at root level (destructured)', () => {
		const source = `const Button = ({children}) => <button>{children}</button>;`;
		expect(detectSlotsFromJsx(source)).toBe(true);
	});

	it('returns true for props.children at root level', () => {
		const source = `const Button = (props) => <button>{props.children}</button>;`;
		expect(detectSlotsFromJsx(source)).toBe(true);
	});

	it('returns true for children at root level with return statement', () => {
		const source = `
			function Button({children}) {
				return <button>{children}</button>;
			}
		`;
		expect(detectSlotsFromJsx(source)).toBe(true);
	});

	it('returns SlotElement[] for children in nested element', () => {
		const source = `
			const Card = ({children}) => (
				<div>
					<h2>Title</h2>
					<p>{children}</p>
				</div>
			);
		`;
		const result = detectSlotsFromJsx(source);
		expect(result).toEqual([{ element: 'p' }]);
	});

	it('returns SlotElement[] for props.children in nested element', () => {
		const source = `
			const Card = (props) => (
				<div>
					<h2>Title</h2>
					<section>{props.children}</section>
				</div>
			);
		`;
		const result = detectSlotsFromJsx(source);
		expect(result).toEqual([{ element: 'section' }]);
	});

	it('handles deeply nested children', () => {
		const source = `
			const Layout = ({children}) => (
				<div className="layout">
					<header>
						<nav>Menu</nav>
					</header>
					<main>
						<article>{children}</article>
					</main>
				</div>
			);
		`;
		const result = detectSlotsFromJsx(source);
		expect(result).toEqual([{ element: 'article' }]);
	});

	it('handles arrow function with parenthesized return', () => {
		const source = `
			const Wrapper = ({children}) => (
				<div className="wrapper">
					<span>{children}</span>
				</div>
			);
		`;
		const result = detectSlotsFromJsx(source);
		expect(result).toEqual([{ element: 'span' }]);
	});

	it('handles children with spaces in expression', () => {
		const source = `const Box = ({children}) => <div>{ children }</div>;`;
		expect(detectSlotsFromJsx(source)).toBe(true);
	});

	it('handles props.children with spaces in expression', () => {
		const source = `const Box = (props) => <div>{ props.children }</div>;`;
		expect(detectSlotsFromJsx(source)).toBe(true);
	});

	it('returns null for self-closing custom component root', () => {
		const source = `const App = () => <SomeComponent prop="value" />;`;
		expect(detectSlotsFromJsx(source)).toBeNull();
	});

	it('handles function component with return and parentheses', () => {
		const source = `
			function Panel({children, title}) {
				return (
					<div className="panel">
						<h3>{title}</h3>
						<div className="panel-body">{children}</div>
					</div>
				);
			}
		`;
		const result = detectSlotsFromJsx(source);
		expect(result).toEqual([{ element: 'div' }]);
	});
});
