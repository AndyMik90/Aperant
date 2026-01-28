/**
 * Rehype plugin to unwrap <p> tags that contain block-level elements.
 *
 * This fixes React warnings about invalid HTML nesting like:
 * "In HTML, <p> cannot be a descendant of <p>"
 * "In HTML, <div> cannot be a descendant of <p>"
 *
 * The plugin transforms:
 *   <p><div>...</div></p> → <div>...</div>
 *   <p><pre>...</pre></p> → <pre>...</pre>
 *
 * @type {import('unified').Plugin<any[]>}
 */
export function rehypeUnwrapP() {
	return (tree: any) => {
		/**
		 * Check if a node contains block-level children
		 */
		const hasBlockChildren = (node: any): boolean => {
			if (!node.children || !Array.isArray(node.children)) {
				return false;
			}
			return node.children.some((child: any) => {
				// Check for block-level elements by tag name
				if (child.type === 'element') {
					const blockTags = new Set([
						'address', 'article', 'aside', 'blockquote', 'canvas', 'dd', 'div',
						'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
						'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
						'li', 'main', 'nav', 'noscript', 'ol', 'output', 'p', 'pre',
						'section', 'table', 'tfoot', 'ul', 'video'
					]);
					return blockTags.has(child.tagName);
				}
				return false;
			});
		};

		/**
		 * Recursively unwrap <p> tags that contain block-level elements
		 */
		const unwrapP = (node: any, parent: any, index: number) => {
			if (node.type === 'element' && node.tagName === 'p') {
				// If this <p> contains block-level elements, unwrap it
				if (hasBlockChildren(node)) {
					// Replace <p> with its children
					if (parent && typeof index === 'number') {
						parent.children.splice(index, 1, ...node.children);
					}
				}
			}

			// Recursively process children
			if (node.children && Array.isArray(node.children)) {
				let i = 0;
				while (i < node.children.length) {
					const child = node.children[i];
					unwrapP(child, node, i);
					// After unwrapping, the child at index i might have changed
					// so we need to check if it's still the same
					if (node.children[i] !== child) {
						// Child was replaced, don't increment i
						continue;
					}
					i++;
				}
			}
		};

		unwrapP(tree, null, 0);
	};
}
