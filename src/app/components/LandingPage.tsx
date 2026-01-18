import { motion } from 'motion/react';
import { EmberParticles } from './EmberParticles';
import { PhoenixLogo } from './PhoenixLogo';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import {
  BarChart3,
  Trophy,
  Calendar,
  Users,
  Share2,
  Zap,
  TrendingUp,
  Target,
  Award,
  Check,
  ArrowRight,
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onNavigateToPrivacy?: () => void;
}

export function LandingPage({ onGetStarted, onNavigateToPrivacy }: LandingPageProps) {
  const features = [
    {
      icon: BarChart3,
      title: 'Real-time Analytics',
      description: 'Track every rep, set, and workout with comprehensive data visualization.',
    },
    {
      icon: Trophy,
      title: 'Personal Records',
      description: 'Celebrate your victories with automatic PR detection and tracking.',
    },
    {
      icon: Calendar,
      title: 'Training Cycles',
      description: 'Plan and execute periodized training programs with precision.',
    },
    {
      icon: Users,
      title: 'Community Challenges',
      description: 'Compete with athletes worldwide in dynamic fitness challenges.',
    },
    {
      icon: Share2,
      title: 'Routine Sharing',
      description: 'Discover and share proven workout routines with the community.',
    },
    {
      icon: Zap,
      title: 'Multi-App Sync',
      description: 'Seamlessly integrate with your favorite fitness apps and wearables.',
    },
  ];

  const pricingTiers = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      features: ['Basic workout tracking', '30-day history', 'Community access', 'Routine sharing'],
      cta: 'Get Started',
      highlight: false,
    },
    {
      name: 'Phoenix',
      price: '$9.99',
      period: 'per month',
      features: [
        'Unlimited workout history',
        'Advanced analytics',
        'Training cycles',
        'Priority challenges',
        'All integrations',
        'Export data',
      ],
      cta: 'Rise Now',
      highlight: true,
    },
    {
      name: 'Elite',
      price: '$19.99',
      period: 'per month',
      features: [
        'Everything in Phoenix',
        'AI-powered insights',
        'Personal coaching',
        'Custom badge creation',
        'API access',
        'Priority support',
      ],
      cta: 'Forge Ahead',
      highlight: false,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white overflow-x-hidden">
      <EmberParticles />

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center z-10 flex flex-col items-center"
        >
          <PhoenixLogo size="xl" animated />
          
          <motion.h1
            className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
            style={{ fontFamily: 'system-ui' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <span className="block bg-gradient-to-r from-[#FF6B35] via-[#DC2626] to-[#F59E0B] bg-clip-text text-transparent">
              Project Phoenix
            </span>
          </motion.h1>

          <motion.p
            className="mt-6 text-xl sm:text-2xl md:text-3xl text-[#E5E7EB]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            Rise From the Ashes. Forge Your Strength.
          </motion.p>

          <motion.p
            className="mt-4 text-lg sm:text-xl text-[#6B7280] max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            Community-driven analytics for Vitruvian Trainer
          </motion.p>

          <motion.div
            className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <Button
              size="lg"
              onClick={onGetStarted}
              className="relative group bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] text-white border-0 shadow-lg shadow-[#FF6B35]/50 hover:shadow-xl hover:shadow-[#FF6B35]/70 transition-all duration-300"
            >
              <span className="relative z-10 flex items-center gap-2">
                Get Started
                <ArrowRight className="w-5 h-5" />
              </span>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-2 border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10 hover:border-[#DC2626]"
            >
              View Features
            </Button>
          </motion.div>
        </motion.div>

        <motion.div
          className="absolute bottom-10 animate-bounce"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <div className="w-6 h-10 border-2 border-[#FF6B35] rounded-full flex items-start justify-center p-2">
            <div className="w-1.5 h-1.5 bg-[#FF6B35] rounded-full" />
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#0D0D0D] to-[#1a1a1a]">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl sm:text-5xl mb-4">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Elevate Your Training
              </span>
            </h2>
            <p className="text-xl text-[#6B7280]">
              Everything you need to reach your fitness goals
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all duration-300 group cursor-pointer h-full">
                  <div className="mb-4 w-12 h-12 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl mb-2 text-white">{feature.title}</h3>
                  <p className="text-[#9CA3AF]">{feature.description}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl sm:text-5xl mb-4">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Choose Your Path
              </span>
            </h2>
            <p className="text-xl text-[#6B7280]">
              Select the plan that fits your journey
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {pricingTiers.map((tier, index) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className={tier.highlight ? 'md:-mt-4 md:mb-4' : ''}
              >
                <Card
                  className={`p-8 h-full flex flex-col ${
                    tier.highlight
                      ? 'bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 border-[#FF6B35] border-2 ring-4 ring-[#FF6B35]/20'
                      : 'bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]'
                  }`}
                >
                  {tier.highlight && (
                    <div className="mb-4 px-4 py-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] rounded-full text-sm text-center w-fit mx-auto">
                      RECOMMENDED
                    </div>
                  )}
                  <h3 className="text-2xl mb-2 text-white text-center">{tier.name}</h3>
                  <div className="text-center mb-6">
                    <span className="text-5xl bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                      {tier.price}
                    </span>
                    <span className="text-[#9CA3AF] ml-2">/ {tier.period}</span>
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[#E5E7EB]">
                        <Check className="w-5 h-5 text-[#10B981] flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="lg"
                    onClick={onGetStarted}
                    className={
                      tier.highlight
                        ? 'w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 shadow-lg shadow-[#FF6B35]/50'
                        : 'w-full border-2 border-[#FF6B35] bg-transparent text-[#FF6B35] hover:bg-[#FF6B35]/10'
                    }
                  >
                    {tier.cta}
                  </Button>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D]">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl sm:text-5xl mb-6">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Ready to Transform?
              </span>
            </h2>
            <p className="text-xl text-[#E5E7EB] mb-8">
              Join thousands of athletes who are already rising stronger
            </p>
            <Button
              size="lg"
              onClick={onGetStarted}
              className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] text-white border-0 shadow-lg shadow-[#FF6B35]/50 hover:shadow-xl hover:shadow-[#FF6B35]/70 text-lg px-8 py-6"
            >
              <span className="flex items-center gap-2">
                Start Your Journey
                <ArrowRight className="w-5 h-5" />
              </span>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-12 px-4 sm:px-6 lg:px-8 border-t border-[#374151]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <PhoenixLogo size="sm" animated={false} />
                <span className="text-xl bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                  Project Phoenix
                </span>
              </div>
              <p className="text-[#9CA3AF] text-sm">
                Rise From the Ashes. Forge Your Strength.
              </p>
            </div>
            <div>
              <h4 className="text-white mb-4">Product</h4>
              <ul className="space-y-2 text-[#9CA3AF] text-sm">
                <li className="hover:text-[#FF6B35] cursor-pointer">Features</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Pricing</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Integrations</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Roadmap</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white mb-4">Company</h4>
              <ul className="space-y-2 text-[#9CA3AF] text-sm">
                <li className="hover:text-[#FF6B35] cursor-pointer">About</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Blog</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Careers</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Contact</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-[#9CA3AF] text-sm">
                <li className="hover:text-[#FF6B35] cursor-pointer" onClick={onNavigateToPrivacy}>Privacy</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Terms</li>
                <li className="hover:text-[#FF6B35] cursor-pointer">Security</li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-[#374151] text-center space-y-3">
            <p className="text-[#9CA3AF] text-sm">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent font-semibold">
                Project Phoenix
              </span>{' '}
              is a community preservation project by{' '}
              <span className="text-white font-semibold">9th Level Software LLC</span>
            </p>
            <div className="text-[#6B7280] text-xs max-w-3xl mx-auto space-y-2">
              <p className="font-semibold text-[#9CA3AF]">Legal Notice</p>
              <p>
                Project Phoenix is an independent, community-developed application and is not affiliated with, endorsed by, sponsored by, or supported by Vitruvian Investments Pty Ltd (in Liquidation), managed by Merchants Advisory. Vitruvian and related marks are trademarks of their respective owners.
              </p>
              <p>
                By downloading or using Project Phoenix, you agree to our Terms of Service, which includes important safety warnings and liability disclaimers.
              </p>
            </div>
            <p className="text-[#6B7280] text-xs">
              © 2026 9th Level Software LLC. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}