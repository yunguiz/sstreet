import { useState, useEffect, lazy, Suspense } from 'react';
import { TickerBar } from './components/TickerBar';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { CatalogSection } from './components/CatalogSection';
import { VipBanner } from './components/VipBanner';
import { Footer } from './components/Footer';
import type { PolicyTab } from './components/PoliciesAndFaqModal';
import type { AuthModalMode } from './components/CustomerAuthModal';
import { Product, ProductCategory, CartItem } from './types';
import { getLiveCatalog } from './services/catalog';
import { MiamiRaffleHeroBanner } from './components/MiamiRaffleHeroBanner';
import {
  CustomerProfile,
  logoutCustomer,
  subscribeToCustomerAuth,
} from './services/auth';

const OfficialPartnersSection = lazy(() =>
  import('./components/OfficialPartnersSection').then((m) => ({ default: m.OfficialPartnersSection }))
);
const SocialProofSection = lazy(() =>
  import('./components/SocialProofSection').then((m) => ({ default: m.SocialProofSection }))
);
const Ps5RaffleSection = lazy(() =>
  import('./components/Ps5RaffleSection').then((m) => ({ default: m.Ps5RaffleSection }))
);
const ProductModal = lazy(() =>
  import('./components/ProductModal').then((m) => ({ default: m.ProductModal }))
);
const CartDrawer = lazy(() =>
  import('./components/CartDrawer').then((m) => ({ default: m.CartDrawer }))
);
const FavoritesDrawer = lazy(() =>
  import('./components/FavoritesDrawer').then((m) => ({ default: m.FavoritesDrawer }))
);
const SearchBar = lazy(() =>
  import('./components/SearchBar').then((m) => ({ default: m.SearchBar }))
);
const OrderTrackingModal = lazy(() =>
  import('./components/OrderTrackingModal').then((m) => ({ default: m.OrderTrackingModal }))
);
const PoliciesAndFaqModal = lazy(() =>
  import('./components/PoliciesAndFaqModal').then((m) => ({ default: m.PoliciesAndFaqModal }))
);
const CustomerAuthModal = lazy(() =>
  import('./components/CustomerAuthModal').then((m) => ({ default: m.CustomerAuthModal }))
);
const AdminBlingSyncPage = lazy(() =>
  import('./components/AdminBlingSyncPage').then((m) => ({ default: m.AdminBlingSyncPage }))
);

function StorefrontApp() {
  // Cart state persisted to localStorage
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('street_store_cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Favorites state persisted to localStorage (starts at 0 favorites)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('street_store_favorites');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Remove legacy mock ID so user starts with clean 0 favorites
          return parsed.filter((id) => id !== 'prod-hoodie-void-01');
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartInitialStep, setCartInitialStep] = useState<'cart' | 'checkout'>('cart');
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isTrackingOpen, setIsTrackingOpen] = useState(false);
  const [trackingInitialQuery, setTrackingInitialQuery] = useState('');
  const [isPoliciesOpen, setIsPoliciesOpen] = useState(false);
  const [policiesInitialTab, setPoliciesInitialTab] = useState<PolicyTab>('faq');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedProductInitialColor, setSelectedProductInitialColor] = useState<string | undefined>(undefined);
  const [activeCategory, setActiveCategory] = useState<ProductCategory | 'all'>('all');
  const [activeSubcategory, setActiveSubcategory] = useState<string | undefined>(undefined);
  const [brandFilter, setBrandFilter] = useState<string | undefined>(undefined);

  // Live products loaded automatically from Bling ERP & official store catalog
  const [products, setProducts] = useState<Product[]>([]);
  const [isCatalogLive, setIsCatalogLive] = useState(false);
  const [mercadoPagoSuccessBanner, setMercadoPagoSuccessBanner] = useState<string | null>(null);

  // Customer authentication state (Firebase Auth + Firestore users/{uid})
  const [currentUser, setCurrentUser] = useState<CustomerProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('register');
  const [authModalReason, setAuthModalReason] = useState<string | null>(null);
  const [pendingCheckoutAfterAuth, setPendingCheckoutAfterAuth] = useState(false);
  const [currentRoutePath, setCurrentRoutePath] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') || '/' : '/'
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoutePath(window.location.pathname.replace(/\/+$/, '') || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToCustomerAuth((profile) => {
      setCurrentUser(profile);
    });
    return () => unsubscribe();
  }, []);

  // Automatic real-time catalog sync with Bling ERP
  useEffect(() => {
    let mounted = true;
    const followUpTimers: number[] = [];

    const applyCatalogResult = (res: Awaited<ReturnType<typeof getLiveCatalog>>) => {
      if (!mounted) return;
      if (Array.isArray(res.products) && res.products.length > 0) {
        setProducts((prev) => {
          if (prev.length !== res.products.length) return res.products;
          const hasChange = res.products.some(
            (p, i) =>
              p.price !== prev[i]?.price ||
              p.stockCount !== prev[i]?.stockCount ||
              p.name !== prev[i]?.name ||
              p.images?.[0] !== prev[i]?.images?.[0]
          );
          return hasChange ? res.products : prev;
        });
      }
      setIsCatalogLive(res.isLive);
    };

    // 1. Initial live catalog fetch
    getLiveCatalog().then(applyCatalogResult);

    // 2. Periodic background synchronization every 45 seconds
    const intervalId = setInterval(() => {
      getLiveCatalog().then(applyCatalogResult);
    }, 45000);

    // 3. Instant automatic revalidation when tab regains focus
    const handleFocus = () => {
      getLiveCatalog(false).then(applyCatalogResult);
    };
    window.addEventListener('focus', handleFocus);

    // 4. Listen for OAuth completion to pull live Bling catalog automatically
    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'bling') {
        getLiveCatalog(true).then(applyCatalogResult);
        followUpTimers.push(window.setTimeout(() => getLiveCatalog(true).then(applyCatalogResult), 4500));
        followUpTimers.push(window.setTimeout(() => getLiveCatalog(true).then(applyCatalogResult), 12000));
      }
    };
    window.addEventListener('message', handleOAuthMessage);

    return () => {
      mounted = false;
      clearInterval(intervalId);
      followUpTimers.forEach((t) => clearTimeout(t));
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('message', handleOAuthMessage);
    };
  }, []);

  // Listen for Mercado Pago return redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment_status') || params.get('collection_status') || params.get('status');

    if (paymentStatus === 'approved') {
      setMercadoPagoSuccessBanner('Pagamento aprovado com sucesso! Seu pedido foi confirmado e suas peças já estão reservadas no estoque.');
      setCartItems([]);
      localStorage.removeItem('street_store_cart');

      import('canvas-confetti').then((confettiModule) => {
        confettiModule.default({
          particleCount: 100,
          spread: 100,
          origin: { y: 0.4 },
          colors: ['#009EE3', '#E50914', '#00FF66', '#FFFFFF']
        });
      });

      // Clean URL params cleanly without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'pending') {
      setMercadoPagoSuccessBanner('Seu pagamento está em análise/processamento. Assim que compensar, você receberá a confirmação por e-mail.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);


  // Save cart to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('street_store_cart', JSON.stringify(cartItems));
    } catch {
      // ignore
    }
  }, [cartItems]);

  // Save favorites to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('street_store_favorites', JSON.stringify(favorites));
    } catch {
      // ignore
    }
  }, [favorites]);

  const handleToggleFavorite = (productId: string) => {
    setFavorites((prev) => {
      const exists = prev.includes(productId);
      return exists ? prev.filter((id) => id !== productId) : [...prev, productId];
    });
  };

  const totalCartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  const getAvailableStockForChoice = (product: Product, size: string, color?: string): number => {
    const vars = (product.variantsList || []).filter((v) => v.stock > 0);
    if (vars.length > 0) {
      const exact =
        vars.find(
          (v) =>
            (v.size || '').toLowerCase() === size.toLowerCase() &&
            (!color || !v.color || v.color.toLowerCase() === color.toLowerCase())
        ) || vars.find((v) => (v.size || '').toLowerCase() === size.toLowerCase());
      return exact ? exact.stock : 0;
    }
    return product.stockCount ?? 0;
  };

  // Add single item to cart (blocked if stockCount <= 0 or chosen size has 0 stock)
  const handleAddToCart = (
    product: Product,
    size: string,
    color: string,
    quantity: number = 1
  ) => {
    const availableStock = getAvailableStockForChoice(product, size, color);
    if ((product.stockCount ?? 0) <= 0 || availableStock <= 0) {
      setSelectedProductInitialColor(color || undefined);
      setSelectedProduct(product);
      return;
    }

    const cartItemId = `${product.id}-${size}-${color}`;
    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === cartItemId);
      if (existing) {
        return prev.map((item) =>
          item.id === cartItemId
            ? { ...item, quantity: Math.min(availableStock, item.quantity + quantity) }
            : item
        );
      }
      return [
        ...prev,
        {
          id: cartItemId,
          product,
          selectedSize: size,
          selectedColor: color,
          quantity: Math.min(availableStock, Math.max(1, quantity)),
        },
      ];
    });
    setCartInitialStep('cart');
    setIsCartOpen(true);
  };

  // Quick add from card (uses first in-stock size & color, honoring selected card swatch; opens details if out of stock)
  const handleQuickAdd = (product: Product, preferredColor?: string) => {
    if ((product.stockCount ?? 0) <= 0) {
      setSelectedProductInitialColor(preferredColor);
      setSelectedProduct(product);
      return;
    }
    const inStockVars = (product.variantsList || []).filter((v) => v.stock > 0);
    const matchingColorVar =
      preferredColor && preferredColor !== 'Cor Única'
        ? inStockVars.find((v) => (v.color || '').toLowerCase() === preferredColor.toLowerCase())
        : undefined;
    const firstInStockVar = matchingColorVar || inStockVars[0];
    const chosenSize = firstInStockVar?.size || product.sizes[0] || 'Tamanho Único';
    const chosenColor =
      firstInStockVar?.color ||
      (preferredColor && preferredColor !== 'Cor Única' ? preferredColor : product.colors[0]?.name) ||
      'Cor Única';
    handleAddToCart(product, chosenSize, chosenColor, 1);
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const maxStock = Math.max(1, getAvailableStockForChoice(item.product, item.selectedSize, item.selectedColor));
            const newQty = Math.min(maxStock, item.quantity + delta);
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleRemoveItem = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  const openCustomerAuth = (
    mode: AuthModalMode = 'register',
    reason: string | null = null,
    resumeCheckout: boolean = false
  ) => {
    setAuthModalMode(mode);
    setAuthModalReason(reason);
    setPendingCheckoutAfterAuth(resumeCheckout);
    setIsAuthModalOpen(true);
  };

  const handleBuyNow = (
    product: Product,
    size: string,
    color: string,
    quantity: number
  ) => {
    if ((product.stockCount ?? 0) <= 0) {
      setSelectedProduct(product);
      return;
    }
    handleAddToCart(product, size, color, quantity);
    setSelectedProduct(null);

    if (!currentUser) {
      setIsCartOpen(false);
      openCustomerAuth(
        'register',
        'Para finalizar sua compra, crie seu cadastro ou entre na sua conta.',
        true
      );
      return;
    }

    setCartInitialStep('checkout');
    setIsCartOpen(true);
  };

  const navigateToHomeSection = (sectionId?: string) => {
    const isOnRaffleRoute = currentRoutePath === '/sorteio';
    if (isOnRaffleRoute && typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      setCurrentRoutePath('/');
    }
    if (!sectionId) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, isOnRaffleRoute ? 80 : 0);
  };

  const openRafflePage = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/sorteio');
      setCurrentRoutePath('/sorteio');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToCatalog = () => {
    navigateToHomeSection('catalogo');
  };

  const scrollToPartners = () => {
    navigateToHomeSection('parceiros');
  };

  const isRafflePage = currentRoutePath === '/sorteio';

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white flex flex-col selection:bg-[#E50914] selection:text-white w-full max-w-full overflow-x-hidden">
      {/* 1. Top Ticker Marquee Bar */}
      <TickerBar />

      {/* 2. Top Navigation Bar with Enlarged Logo & Sacola */}
      <Header
        cartCount={totalCartCount}
        favoritesCount={favorites.length}
        currentUser={currentUser}
        onOpenAuth={(mode) => openCustomerAuth(mode || 'register', null, false)}
        onLogout={() => {
          void logoutCustomer();
        }}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenFavorites={() => setIsFavoritesOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenTracking={() => {
          setTrackingInitialQuery('');
          setIsTrackingOpen(true);
        }}
        onOpenMyOrders={() => {
          setTrackingInitialQuery('');
          setIsTrackingOpen(true);
        }}
        onOpenPolicies={(tab) => {
          setPoliciesInitialTab(tab);
          setIsPoliciesOpen(true);
        }}
        onGoHome={() => navigateToHomeSection()}
        onNavigateSection={(secId) => navigateToHomeSection(secId)}
        activeCategory={activeCategory}
        onSelectCategory={(cat: ProductCategory | 'all', subcat?: string) => {
          setActiveCategory(cat);
          setActiveSubcategory(subcat);
          scrollToCatalog();
        }}
      />

      {/* Mercado Pago Payment Notification Banner */}
      {mercadoPagoSuccessBanner && (
        <div className="bg-gradient-to-r from-emerald-950 via-zinc-900 to-emerald-950 border-b border-emerald-600/40 text-emerald-200 py-3 px-4 text-xs font-semibold flex items-center justify-between shadow-lg relative z-40">
          <div className="flex items-center gap-2 max-w-4xl mx-auto">
            <span className="text-base">🎉</span>
            <span>{mercadoPagoSuccessBanner}</span>
          </div>
          <button
            onClick={() => setMercadoPagoSuccessBanner(null)}
            className="text-emerald-400 hover:text-white px-2 py-1 rounded bg-black/40 text-xs cursor-pointer ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {isRafflePage ? (
        <main className="flex-1">
          <Suspense fallback={null}>
            <Ps5RaffleSection
              id="sorteio-ps5"
              isDedicatedPage
              onBackToStore={() => navigateToHomeSection()}
              onExploreCatalog={scrollToCatalog}
            />
          </Suspense>
        </main>
      ) : (
        <>
          {/* 3A. Top Miami PS5 + GTA VI Raffle Animated Spotlight (Clicks open /sorteio) */}
          <MiamiRaffleHeroBanner onOpenRafflePage={openRafflePage} />

          {/* 3B. Hero Section */}
          <Hero
            onExploreCatalog={scrollToCatalog}
            onExplorePartners={scrollToPartners}
          />

          {/* 4. Clean Catalog Section */}
          <CatalogSection
            products={products}
            isCatalogLive={isCatalogLive}
            catalogCount={products.length}
            activeCategory={activeCategory}
            activeSubcategory={activeSubcategory}
            brandFilter={brandFilter}
            onClearBrandFilter={() => setBrandFilter(undefined)}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            onSelectCategory={(cat: ProductCategory | 'all', subcat?: string) => {
              setActiveCategory(cat);
              setActiveSubcategory(subcat);
            }}
            onOpenProduct={(prod: Product, initialColor?: string) => {
              setSelectedProductInitialColor(initialColor);
              setSelectedProduct(prod);
            }}
            onQuickAdd={handleQuickAdd}
          />

          {/* 4.5 Compact PS5 + GTA VI Raffle Strip */}
          <Suspense fallback={null}>
            <Ps5RaffleSection
              id="sorteio-ps5"
              onExploreCatalog={scrollToCatalog}
              onOpenRafflePage={openRafflePage}
            />
          </Suspense>

          {/* 5. Official Partner Brands Slider & Showcase */}
          <Suspense fallback={null}>
            <OfficialPartnersSection
              products={products}
              onSelectBrandSearch={(query) => {
                setActiveCategory('all');
                setActiveSubcategory(undefined);
                setBrandFilter(query);
                scrollToCatalog();
              }}
            />
          </Suspense>

          {/* 6. VIP WhatsApp Club Section */}
          <VipBanner />

          {/* 7. Instagram Feed (@streetstoreitabira) & Customer Social Proof */}
          <Suspense fallback={null}>
            <SocialProofSection products={products} />
          </Suspense>
        </>
      )}

      {/* 8. Complete Official Footer */}
      <Footer
        onOpenTracking={() => {
          setTrackingInitialQuery('');
          setIsTrackingOpen(true);
        }}
        onOpenPolicies={(tab) => {
          setPoliciesInitialTab(tab);
          setIsPoliciesOpen(true);
        }}
        onSelectCategory={(cat: ProductCategory | 'all', subcat?: string) => {
          setActiveCategory(cat);
          setActiveSubcategory(subcat);
          setBrandFilter(undefined);
          scrollToCatalog();
        }}
      />

      {/* Modal: Product Details Drawer */}
      <Suspense fallback={null}>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            initialColor={selectedProductInitialColor}
            isOpen={Boolean(selectedProduct)}
            isFavorited={favorites.includes(selectedProduct.id)}
            onToggleFavorite={handleToggleFavorite}
            onClose={() => {
              setSelectedProduct(null);
              setSelectedProductInitialColor(undefined);
            }}
            onAddToCart={handleAddToCart}
            onBuyNow={handleBuyNow}
          />
        )}

        {/* Slide-over Cart Drawer */}
        {isCartOpen && (
          <CartDrawer
            isOpen={isCartOpen}
            onClose={() => setIsCartOpen(false)}
            items={cartItems}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onClearCart={handleClearCart}
            initialStep={cartInitialStep}
            currentUser={currentUser}
            onRequireAuth={() => {
              setIsCartOpen(false);
              openCustomerAuth(
                'register',
                'Para concluir o pagamento, entre ou crie seu cadastro rápido.',
                true
              );
            }}
            onOpenTracking={(orderNum) => {
              setTrackingInitialQuery(orderNum || '');
              setIsTrackingOpen(true);
            }}
          />
        )}

        {/* Customer Registration & Login Modal */}
        {isAuthModalOpen && (
          <CustomerAuthModal
            isOpen={isAuthModalOpen}
            initialMode={authModalMode}
            reasonMessage={authModalReason}
            onClose={() => {
              setIsAuthModalOpen(false);
              setAuthModalReason(null);
              setPendingCheckoutAfterAuth(false);
            }}
            onSuccess={(profile) => {
              setCurrentUser(profile);
              setIsAuthModalOpen(false);
              setAuthModalReason(null);
              if (pendingCheckoutAfterAuth) {
                setPendingCheckoutAfterAuth(false);
                setCartInitialStep('checkout');
                setIsCartOpen(true);
              }
            }}
          />
        )}

        {/* Slide-over Favorites Wishlist Drawer */}
        {isFavoritesOpen && (
            <FavoritesDrawer
            isOpen={isFavoritesOpen}
            onClose={() => setIsFavoritesOpen(false)}
            favoriteProducts={products.filter((p) => favorites.includes(p.id))}
            onRemoveFavorite={handleToggleFavorite}
            onOpenProduct={(prod: Product) => {
              setSelectedProductInitialColor(undefined);
              setSelectedProduct(prod);
            }}
            onQuickAdd={handleQuickAdd}
          />
        )}

        {/* Instant Product Search Modal with Autocomplete */}
        {isSearchOpen && (
          <SearchBar
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
            products={products}
            onSelectProduct={(prod: Product) => {
              setSelectedProductInitialColor(undefined);
              setSelectedProduct(prod);
            }}
          />
        )}

        {/* Order Tracking & Returns Modal */}
        {isTrackingOpen && (
          <OrderTrackingModal
            isOpen={isTrackingOpen}
            onClose={() => setIsTrackingOpen(false)}
            initialQuery={trackingInitialQuery}
            currentUser={currentUser}
          />
        )}

        {/* Policies & FAQ Modal (Entregas, Trocas e Devoluções, Perguntas Frequentes) */}
        {isPoliciesOpen && (
          <PoliciesAndFaqModal
            isOpen={isPoliciesOpen}
            initialTab={policiesInitialTab}
            onClose={() => setIsPoliciesOpen(false)}
            onOpenTracking={(orderNum) => {
              setIsPoliciesOpen(false);
              setTrackingInitialQuery(orderNum || '');
              setIsTrackingOpen(true);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

export default function App() {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : '';

  if (pathname === '/admin/bling') {
    return (
      <Suspense fallback={null}>
        <AdminBlingSyncPage />
      </Suspense>
    );
  }

  return <StorefrontApp />;
}
