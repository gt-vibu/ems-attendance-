/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Quote, Star, ChevronLeft, ChevronRight } from 'lucide-react';

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  feature: string;
  avatar: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote: "We eliminated manual timesheet matching altogether. Perimeter automatically flags geofence gaps and reconciles breaks without supervisor intervention.",
    name: "Marcus Aurelius",
    role: "Ops Manager, Rome Field Services",
    feature: "◦ Presence tracker",
    avatar: "MA"
  },
  {
    quote: "Our audit compliance logs are finally pristine. Corrections are handled through immutable, versioned workflows rather than quiet database overrides.",
    name: "Sarah Jenkins",
    role: "HR Director, Tech Campus Corp",
    feature: "◦ Corrections workflow",
    avatar: "SJ"
  },
  {
    quote: "GPS-gap alerts save us hours of debate on field locations. The system alerts us the moment tracking coordinates are disabled or spoofed.",
    name: "John Doe",
    role: "Field Supervisor, West Logistics",
    feature: "◦ Geofence guard",
    avatar: "JD"
  },
  {
    quote: "The dual-stage approval pipeline is incredibly elegant. Our team supervisors approve coordinates first, and HR audits them in seconds.",
    name: "Emma Watson",
    role: "People Ops Lead, Global Logistics",
    feature: "◦ Approvals pipeline",
    avatar: "EW"
  },
  {
    quote: "Immutable policy versioning ensures safety. We reduced the check-in radii for three hubs without changing past historic hours reports.",
    name: "David Miller",
    role: "IT Compliance Officer, Enterprise Tech",
    feature: "◦ Policy safety",
    avatar: "DM"
  }
];

// Tripled array for infinite scroll
const SCROLL_ITEMS = [...TESTIMONIALS, ...TESTIMONIALS, ...TESTIMONIALS];

export default function TestimonialCarousel() {
  const [activeIndex, setActiveIndex] = useState(TESTIMONIALS.length); // Start at second group
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHovered) return;
    
    const interval = setInterval(() => {
      handleNext();
    }, 4000);

    return () => clearInterval(interval);
  }, [activeIndex, isHovered]);

  const handlePrev = () => {
    setActiveIndex((prev) => {
      const nextIdx = prev - 1;
      if (nextIdx < 0) {
        // Jump without animation back to end of second group
        setTimeout(() => {
          if (trackRef.current) {
            trackRef.current.style.transition = 'none';
            setActiveIndex(TESTIMONIALS.length * 2 - 1);
          }
        }, 800);
      }
      return nextIdx;
    });
  };

  const handleNext = () => {
    setActiveIndex((prev) => {
      const nextIdx = prev + 1;
      if (nextIdx >= SCROLL_ITEMS.length) {
        setTimeout(() => {
          if (trackRef.current) {
            trackRef.current.style.transition = 'none';
            setActiveIndex(TESTIMONIALS.length);
          }
        }, 800);
      }
      return nextIdx;
    });
  };

  // Reset transition style when state updates
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.style.transition = 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    }
  }, [activeIndex]);

  return (
    <section id="testimonials" className="py-24 bg-[#081418] overflow-hidden select-none">
      
      {/* Header Row */}
      <div className="max-w-7xl mx-auto px-6 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <span className="font-mono text-xs text-[#8FE3C0] font-bold block uppercase tracking-widest mb-1">
            VERIFIED VOICES IN OPS
          </span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white tracking-tight leading-none">
            What <span className="font-semibold italic">operators</span> say
          </h2>
        </div>

        <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-2xl">
          <div className="flex gap-0.5 text-amber-400">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-4 h-4 fill-current" />
            ))}
          </div>
          <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
            4.9/5 average rating
          </span>
        </div>
      </div>

      {/* Track & Controls */}
      <div className="relative w-full">
        
        {/* Buttons Overlay */}
        <div className="absolute inset-y-0 left-4 right-4 md:left-12 md:right-12 flex items-center justify-between z-20 pointer-events-none">
          <button
            onClick={handlePrev}
            className="w-12 h-12 rounded-full border border-white/20 bg-[#081418]/80 backdrop-blur-md flex items-center justify-center text-white hover:bg-slate-900 transition-all cursor-pointer pointer-events-auto shadow-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleNext}
            className="w-12 h-12 rounded-full border border-white/20 bg-[#081418]/80 backdrop-blur-md flex items-center justify-center text-white hover:bg-slate-900 transition-all cursor-pointer pointer-events-auto shadow-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Carousel Window */}
        <div 
          className="w-full overflow-hidden"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div 
            ref={trackRef}
            className="flex gap-6 px-4 md:px-12"
            style={{
              transform: `translateX(calc(-${activeIndex * 451.5}px + 50vw - 225.75px))`
            }}
          >
            {SCROLL_ITEMS.map((item, idx) => (
              <div 
                key={`${item.name}-${idx}`}
                className="w-[427.5px] shrink-0 bg-[#0B1E22] border border-[#143239] rounded-3xl p-8 flex flex-col justify-between h-[230px] shadow-lg transition-transform duration-300"
              >
                <div>
                  <Quote className="w-5 h-5 text-[#8FE3C0] mb-4 opacity-50" />
                  <p className="font-sans text-xs text-[#DDEDF0] leading-relaxed font-medium line-clamp-3">
                    "{item.quote}"
                  </p>
                </div>

                <div className="flex justify-between items-end border-t border-white/5 pt-4 mt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center text-[10px] font-mono font-bold text-[#8FE3C0]">
                      {item.avatar}
                    </div>
                    <div>
                      <h4 className="text-xs font-display font-black text-[#F4FBFF]">{item.name}</h4>
                      <p className="text-[10px] font-sans text-slate-400">{item.role}</p>
                    </div>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-[#8FE3C0] uppercase tracking-wide">
                    {item.feature}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
