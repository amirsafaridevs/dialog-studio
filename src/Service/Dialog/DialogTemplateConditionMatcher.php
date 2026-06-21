<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

class DialogTemplateConditionMatcher
{
	/**
	 * Match a set of template conditions against the current request.
	 * Returns the best-matching rule (highest specificity).
	 *
	 * @param array<string, mixed>|null $conditions
	 * @return array{matched: bool, rule_index: int, specificity: int}
	 */
	public function findBestMatch( ?array $conditions ): array
	{
		if ( empty( $conditions ) ) {
			return [ 'matched' => true, 'rule_index' => -1, 'specificity' => 0 ];
		}

		$rules = $conditions['rules'] ?? [];

		if ( ! is_array( $rules ) || $rules === [] ) {
			return [ 'matched' => true, 'rule_index' => -1, 'specificity' => 0 ];
		}

		$best_match = null;
		$best_specificity = -1;

		foreach ( $rules as $index => $rule ) {
			if ( ! is_array( $rule ) ) {
				continue;
			}

			$result = $this->evaluateRule( $rule );

			if ( $result['matched'] && $result['specificity'] > $best_specificity ) {
				$best_match = [ 'matched' => true, 'rule_index' => $index, 'specificity' => $result['specificity'] ];
				$best_specificity = $result['specificity'];
			}
		}

		return $best_match ?? [ 'matched' => false, 'rule_index' => -1, 'specificity' => 0 ];
	}

	/**
	 * Legacy: Simple matches for compatibility. Returns true if ANY rule matches.
	 *
	 * @param array<string, mixed>|null $conditions
	 */
	public function matches( ?array $conditions ): bool
	{
		$result = $this->findBestMatch( $conditions );

		return $result['matched'];
	}

	/**
	 * Evaluate a single rule and return match status + specificity score.
	 *
	 * @param array<string, mixed> $rule
	 * @return array{matched: bool, specificity: int}
	 */
	private function evaluateRule( array $rule ): array
	{
		$page = (string) ( $rule['page'] ?? '' );

		if ( $page === '' ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		return match ( $page ) {
			'front_page' => $this->matchFrontPage( $rule ),
			'singular'   => $this->matchSingular( $rule ),
			'archive'    => $this->matchArchive( $rule ),
			'search'     => $this->matchSearch( $rule ),
			'404'        => $this->match404( $rule ),
			'woocommerce' => $this->matchWooCommerce( $rule ),
			default      => [ 'matched' => false, 'specificity' => 0 ],
		};
	}

	/**
	 * @return array{matched: bool, specificity: int}
	 */
	private function matchFrontPage( array $rule ): array
	{
		if ( ! is_front_page() || is_home() ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		return [ 'matched' => true, 'specificity' => 1 ];
	}

	/**
	 * @return array{matched: bool, specificity: int}
	 */
	private function matchSingular( array $rule ): array
	{
		if ( ! is_singular() ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		$current_post_type = get_post_type();
		$current_post_id = (int) get_queried_object_id();
		$specificity = 0;

		if ( isset( $rule['post_type'] ) ) {
			$required_type = (string) $rule['post_type'];

			if ( $current_post_type !== $required_type ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 1;
		}

		if ( isset( $rule['post_id'] ) ) {
			$required_id = (int) $rule['post_id'];

			if ( $current_post_id !== $required_id ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 2;
		}

		if ( isset( $rule['slug'] ) ) {
			$required_slug = (string) $rule['slug'];
			$post = get_queried_object();

			if ( ! $post instanceof \WP_Post || $post->post_name !== $required_slug ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 2;
		}

		return [ 'matched' => true, 'specificity' => max( 1, $specificity ) ];
	}

	/**
	 * Match archive pages: post type archives, term archives, author, date.
	 *
	 * @return array{matched: bool, specificity: int}
	 */
	private function matchArchive( array $rule ): array
	{
		if ( is_admin() ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		$post_type = $rule['post_type'] ?? null;
		$taxonomy = $rule['taxonomy'] ?? null;
		$term_id = $rule['term_id'] ?? null;
		$archive_type = $rule['archive_type'] ?? null;

		$specificity = 0;

		if ( $post_type !== null ) {
			if ( ! is_post_type_archive( (string) $post_type ) ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 1;
		} elseif ( $taxonomy !== null ) {
			if ( ! is_tax( (string) $taxonomy ) && ! is_category( (string) $taxonomy ) && ! is_tag( (string) $taxonomy ) ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 1;

			if ( $term_id !== null ) {
				if ( (int) get_queried_object_id() !== (int) $term_id ) {
					return [ 'matched' => false, 'specificity' => 0 ];
				}

				$specificity += 1;
			}
		} elseif ( $archive_type !== null ) {
			$archive_type = (string) $archive_type;

			if ( $archive_type === 'author' && ! is_author() ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			if ( $archive_type === 'date' && ! is_date() ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			if ( $archive_type === 'home' && ! is_home() ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 1;
		} else {
			if ( ! is_archive() && ! is_post_type_archive() && ! is_home() && ! is_author() && ! is_date() ) {
				return [ 'matched' => false, 'specificity' => 0 ];
			}

			$specificity += 1;
		}

		return [ 'matched' => true, 'specificity' => max( 1, $specificity ) ];
	}

	/**
	 * @return array{matched: bool, specificity: int}
	 */
	private function matchSearch( array $rule ): array
	{
		if ( ! is_search() ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		return [ 'matched' => true, 'specificity' => 1 ];
	}

	/**
	 * @return array{matched: bool, specificity: int}
	 */
	private function match404( array $rule ): array
	{
		if ( ! is_404() ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		return [ 'matched' => true, 'specificity' => 1 ];
	}

	/**
	 * Match WooCommerce pages (shop, single product, endpoints: cart, checkout, account, etc.)
	 *
	 * @return array{matched: bool, specificity: int}
	 */
	private function matchWooCommerce( array $rule ): array
	{
		if ( ! function_exists( 'is_woocommerce' ) ) {
			return [ 'matched' => false, 'specificity' => 0 ];
		}

		$endpoint = $rule['endpoint'] ?? null;
		$specificity = 0;

		if ( $endpoint === null ) {
			if ( is_woocommerce() || is_product() || is_product_category() ) {
				return [ 'matched' => true, 'specificity' => 1 ];
			}

			return [ 'matched' => false, 'specificity' => 0 ];
		}

		$endpoint = (string) $endpoint;

		if ( function_exists( 'is_wc_endpoint_url' ) && is_wc_endpoint_url( $endpoint ) ) {
			return [ 'matched' => true, 'specificity' => 2 ];
		}

		if ( function_exists( 'is_account_page' ) && $endpoint === 'account' && is_account_page() ) {
			return [ 'matched' => true, 'specificity' => 2 ];
		}

		if ( function_exists( 'is_cart' ) && $endpoint === 'cart' && is_cart() ) {
			return [ 'matched' => true, 'specificity' => 2 ];
		}

		if ( function_exists( 'is_checkout' ) && $endpoint === 'checkout' && is_checkout() ) {
			return [ 'matched' => true, 'specificity' => 2 ];
		}

		if ( function_exists( 'is_checkout_pay_page' ) && $endpoint === 'order-pay' && is_checkout_pay_page() ) {
			return [ 'matched' => true, 'specificity' => 2 ];
		}

		return [ 'matched' => false, 'specificity' => 0 ];
	}
}
