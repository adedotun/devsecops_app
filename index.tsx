import React, { useState, useCallback, useRef, FormEvent, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Chat, Type, Modality } from "@google/genai";
import { marked } from "marked";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const API_KEY = process.env.API_KEY;

const TOPICS = {
  beginner: [
    "What is DevSecOps?",
    "Core Principles of DevSecOps",
    "Continuous Integration/Continuous Delivery (CI/CD)",
    "Infrastructure as Code (IaC)",
    "Security Champions Program",
  ],
  intermediate: [
    "Static Application Security Testing (SAST)",
    "Dynamic Application Security Testing (DAST)",
    "Software Composition Analysis (SCA)",
    "Threat Modeling in the SDLC",
    "Container Security Best Practices",
  ],
  advanced: [
    "Interactive Application Security Testing (IAST)",
    "Runtime Application Self-Protection (RASP)",
    "Policy as Code (PaC)",
    "Secrets Management at Scale",
    "Automated Security Orchestration",
  ],
  master: [
    "Chaos Engineering for Security",
    "Building a DevSecOps Culture",
    "Measuring DevSecOps Success (Metrics & KPIs)",
    "Advanced Cloud Native Security",
    "Supply Chain Security (SLSA, SBOM)",
  ],
  aiInDevSecOps: [
    "AI-Powered Threat Detection",
    "Automated Code Remediation with AI",
    "AI for Security Policy Generation",
    "Predictive Risk Analysis using AI",
    "AI in Security Testing (Fuzzing & Pen-testing)",
  ]
};

const ALL_TOPICS_FLAT = Object.values(TOPICS).flat();
const TOTAL_TOPICS = ALL_TOPICS_FLAT.length;

const LEARNING_RATES = {
    '2': 'Casual (2 topics/week)',
    '5': 'Regular (5 topics/week)',
    '10': 'Intensive (10 topics/week)'
};

const REVIEW_INTERVALS = [3, 7, 14, 30]; // Spaced repetition intervals in days

type QuizQuestion = {
  question: string;
  options: string[];
  answer: string;
};

type ScanFinding = {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  recommendation: string;
};

type CodeQualitySuggestion = {
  lineNumber: number;
  suggestion: string;
  explanation: string;
  suggestedCode: string;
};

type ChatMessage = {
  role: 'user' | 'model';
  htmlContent: string;
}

type CVE = {
  cveId: string;
  description: string;
  cvssScore: number;
}

type OWASP = {
  owaspId: string;
  name: string;
  summary: string;
}

type DiagramNode = {
  id: string;
  label: string;
  tooltip: string;
};
type DiagramEdge = {
  from: string;
  to: string;
};
type DiagramData = {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};
type ActiveTooltip = {
  content: string;
  x: number;
  y: number;
};

type CertificationResult = {
  score: number;
  feedbackSummary: string;
  strengths: string[];
  areasForImprovement: string[];
};

type NewsArticle = {
    uri: string;
    title: string;
};


const App = () => {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [topicSummary, setTopicSummary] = useState<string | null>(null);
  const [topicIllustrationUrl, setTopicIllustrationUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [activeMode, setActiveMode] = useState<'read' | 'quiz' | 'playground'>('read');
  const [topicDescriptions, setTopicDescriptions] = useState<Record<string, string>>({});
  
  // Search State
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Progress State
  const [completedTopics, setCompletedTopics] = useState<Record<string, boolean>>(() => {
    try {
        const savedProgress = localStorage.getItem('devsecopsAcademyProgress');
        return savedProgress ? JSON.parse(savedProgress) : {};
    } catch (e) {
        console.error("Failed to parse progress from localStorage", e);
        return {};
    }
  });

  const [learningRate, setLearningRate] = useState<number>(() => {
    try {
      const savedRate = localStorage.getItem('devsecopsLearningRate');
      return savedRate ? parseInt(savedRate, 10) : 5; // Default to 'Regular'
    } catch (e) {
      console.error("Failed to parse learning rate from localStorage", e);
      return 5;
    }
  });
  
  const [bookmarkedTopics, setBookmarkedTopics] = useState<Record<string, boolean>>(() => {
    try {
        const savedBookmarks = localStorage.getItem('devsecopsAcademyBookmarks');
        return savedBookmarks ? JSON.parse(savedBookmarks) : {};
    } catch (e) {
        console.error("Failed to parse bookmarks from localStorage", e);
        return {};
    }
  });

  // Spaced Repetition State
  const [reviewSchedule, setReviewSchedule] = useState<Record<string, { nextReviewDate: string; intervalIndex: number; }>>(() => {
    try {
        const savedSchedule = localStorage.getItem('devsecopsAcademyReviewSchedule');
        return savedSchedule ? JSON.parse(savedSchedule) : {};
    } catch (e) {
        console.error("Failed to parse review schedule from localStorage", e);
        return {};
    }
  });

  const [topicsForReview, setTopicsForReview] = useState<Record<string, boolean>>({});


  // Video State
  const [isVideoGenerating, setIsVideoGenerating] = useState<boolean>(false);
  const [topicExplainerVideoUrl, setTopicExplainerVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  
  // Diagram State
  const [topicDiagramData, setTopicDiagramData] = useState<DiagramData | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null);

  // Global View State
  const [activeGlobalView, setActiveGlobalView] = useState<'topics' | 'vulnerabilities' | 'glossary' | 'certification' | 'news'>('topics');
  
  // Vulnerability Feed State
  const [vulnerabilityData, setVulnerabilityData] = useState<{ latest: CVE[], owasp: OWASP[] } | null>(null);
  const [isVulnerabilityLoading, setIsVulnerabilityLoading] = useState<boolean>(false);
  const [activeVulnerabilityTab, setActiveVulnerabilityTab] = useState<'latest' | 'owasp'>('latest');
  const [vulnerabilityError, setVulnerabilityError] = useState<string | null>(null);

  // News Feed State
  const [newsData, setNewsData] = useState<{ summary: string, sources: NewsArticle[] } | null>(null);
  const [isNewsLoading, setIsNewsLoading] = useState<boolean>(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  
  // Glossary State
  const [glossaryData, setGlossaryData] = useState<Record<string, string> | null>(null);
  const [isGlossaryLoading, setIsGlossaryLoading] = useState<boolean>(false);
  const [glossaryError, setGlossaryError] = useState<string | null>(null);
  const [glossarySearchTerm, setGlossarySearchTerm] = useState<string>('');

  // Certification State
  const [certificationChallenge, setCertificationChallenge] = useState<string | null>(null);
  const [certificationSolution, setCertificationSolution] = useState<string>('');
  const [certificationResult, setCertificationResult] = useState<CertificationResult | null>(null);


  useEffect(() => {
    try {
        localStorage.setItem('devsecopsAcademyProgress', JSON.stringify(completedTopics));
    } catch (e) {
        console.error("Failed to save progress to localStorage", e);
    }
  }, [completedTopics]);
  
  useEffect(() => {
    try {
        localStorage.setItem('devsecopsLearningRate', learningRate.toString());
    } catch (e) {
        console.error("Failed to save learning rate to localStorage", e);
    }
  }, [learningRate]);

  useEffect(() => {
    try {
        localStorage.setItem('devsecopsAcademyBookmarks', JSON.stringify(bookmarkedTopics));
    } catch(e) {
        console.error("Failed to save bookmarks to localStorage", e);
    }
  }, [bookmarkedTopics]);

  useEffect(() => {
    try {
        localStorage.setItem('devsecopsAcademyReviewSchedule', JSON.stringify(reviewSchedule));
    } catch (e) {
        console.error("Failed to save review schedule to localStorage", e);
    }
  }, [reviewSchedule]);

  useEffect(() => {
    const now = new Date();
    const dueTopics: Record<string, boolean> = {};
    for (const topic in reviewSchedule) {
        const schedule = reviewSchedule[topic];
        if (new Date(schedule.nextReviewDate) <= now) {
            dueTopics[topic] = true;
        }
    }
    setTopicsForReview(dueTopics);
  }, [reviewSchedule]); // Re-run when schedule changes or app loads


  useEffect(() => {
    // Clean up the object URL when the component unmounts or the URL changes
    // to prevent memory leaks.
    let currentUrl = topicExplainerVideoUrl;
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [topicExplainerVideoUrl]);
  
  const conversationContentRef = useRef<HTMLDivElement>(null);
  const exportContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const contentElement = conversationContentRef.current;
    if (!contentElement || !glossaryData) return;

    const handleMouseEnter = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const term = target.dataset.term;
        if (term && glossaryData[term]) {
            const rect = target.getBoundingClientRect();
            setActiveTooltip({
                content: glossaryData[term],
                x: rect.left + window.scrollX + rect.width / 2,
                y: rect.top + window.scrollY - 10,
            });
        }
    };

    const handleMouseLeave = () => {
        setActiveTooltip(null);
    };

    const glossaryTerms = contentElement.querySelectorAll('glossary-term');
    glossaryTerms.forEach(termElement => {
        termElement.addEventListener('mouseenter', handleMouseEnter);
        termElement.addEventListener('mouseleave', handleMouseLeave);
    });

    return () => {
        glossaryTerms.forEach(termElement => {
            termElement.removeEventListener('mouseenter', handleMouseEnter);
            termElement.removeEventListener('mouseleave', handleMouseLeave);
        });
    };
}, [conversation, glossaryData]);

  useEffect(() => {
    const fetchInitialData = async () => {
      // Fetch topic descriptions
      try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `For the following list of DevSecOps topics, generate a single, beginner-friendly sentence describing each one. Return the result as a single JSON object with a single key named "descriptions". The value of this "descriptions" key must be another JSON object, where each key is one of the exact topic names from the provided list, and the corresponding value is the one-sentence description. Ensure all special characters within the description strings are correctly escaped for valid JSON. Topics: ${JSON.stringify(ALL_TOPICS_FLAT)}`,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 100 },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                descriptions: {
                  type: Type.OBJECT,
                  properties: ALL_TOPICS_FLAT.reduce((acc, topic) => {
                    acc[topic] = { type: Type.STRING };
                    return acc;
                  }, {} as Record<string, { type: Type }>)
                }
              },
              required: ["descriptions"]
            }
          }
        });
        const parsedDescriptions = JSON.parse(response.text);
        setTopicDescriptions(parsedDescriptions.descriptions);
      } catch (e) {
        console.error("Failed to fetch topic descriptions:", e);
        setTopicDescriptions({});
      }
    };
    fetchInitialData();
  }, []);
  
  const fetchGlossary = useCallback(async () => {
    if (glossaryData) return;
    setIsGlossaryLoading(true);
    setGlossaryError(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Generate a comprehensive glossary of at least 20 common DevSecOps terms. Include acronyms like SAST, DAST, IAST, RASP, IaC, PaC, CI/CD, SCA, SLSA, and SBOM. Return a single JSON object where keys are the terms/acronyms and values are their definitions.',
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    description: "A JSON object where each key is a DevSecOps term and the value is its definition.",
                    properties: {}, 
                },
            }
        });
        const data = JSON.parse(response.text);
        setGlossaryData(data);
    } catch (e) {
        console.error("Failed to fetch glossary:", e);
        setGlossaryError("Could not load the glossary. Please try again.");
    } finally {
        setIsGlossaryLoading(false);
    }
  }, [glossaryData]);


  // Quiz State
  const [quizData, setQuizData] = useState<QuizQuestion[] | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
  const [quizScore, setQuizScore] = useState<number | null>(null);

  // Playground State
  const [playgroundScenario, setPlaygroundScenario] = useState<string | null>(null);
  const [playgroundFileName, setPlaygroundFileName] = useState<string | null>(null);
  const [initialPlaygroundFileContent, setInitialPlaygroundFileContent] = useState<string>('');
  const [playgroundFileContent, setPlaygroundFileContent] = useState('');
  const [scanResults, setScanResults] = useState<ScanFinding[] | null>(null);
  const [codeQualityResults, setCodeQualityResults] = useState<CodeQualitySuggestion[] | null>(null);
  
  const chatSessionRef = useRef<Chat | null>(null);
  
  const markTopicAsComplete = (topic: string) => {
    // Add to completed topics list
    setCompletedTopics(prev => ({...prev, [topic]: true}));
    
    // Update or create review schedule
    setReviewSchedule(prevSchedule => {
        const newSchedule = {...prevSchedule};
        const currentSchedule = newSchedule[topic];
        const now = new Date();
        
        if (currentSchedule) { // This is a review
            const nextIntervalIndex = currentSchedule.intervalIndex + 1;
            if (nextIntervalIndex < REVIEW_INTERVALS.length) {
                const nextIntervalDays = REVIEW_INTERVALS[nextIntervalIndex];
                now.setDate(now.getDate() + nextIntervalDays);
                newSchedule[topic] = {
                    nextReviewDate: now.toISOString(),
                    intervalIndex: nextIntervalIndex,
                };
            } else {
                // Mastered! Remove from schedule
                delete newSchedule[topic];
            }
        } else { // First time completion
            const nextIntervalDays = REVIEW_INTERVALS[0];
            now.setDate(now.getDate() + nextIntervalDays);
            newSchedule[topic] = {
                nextReviewDate: now.toISOString(),
                intervalIndex: 0,
            };
        }
        return newSchedule;
    });

    // Since the topic has just been reviewed, remove it from the 'due' list for this session
    setTopicsForReview(prev => {
        const newTopicsForReview = {...prev};
        delete newTopicsForReview[topic];
        return newTopicsForReview;
    });
  };
  
  const toggleBookmark = (topic: string) => {
    setBookmarkedTopics(prev => {
        const newBookmarks = {...prev};
        if (newBookmarks[topic]) {
            delete newBookmarks[topic];
        } else {
            newBookmarks[topic] = true;
        }
        return newBookmarks;
    });
  };
  
  const highlightGlossaryTerms = (text: string, glossary: Record<string, string>): string => {
    if (!glossary) return text;
  
    // Sort keys by length, descending, to match longer phrases first (e.g., "Continuous Integration" before "Integration")
    const terms = Object.keys(glossary).sort((a, b) => b.length - a.length);
  
    // Create a regex that matches any of the terms as whole words, case-insensitively
    const regex = new RegExp(`\\b(${terms.join('|')})\\b`, 'gi');
  
    // Split by code blocks to avoid replacements inside them
    const parts = text.split(/(```[\s\S]*?```)/);
  
    const processedParts = parts.map(part => {
      if (part.startsWith('```')) {
        // This is a code block, return it as is
        return part;
      } else {
        // This is regular text, perform replacement
        return part.replace(regex, (match) => {
          // Find the original casing from the glossary keys for the data-term attribute
          const originalTerm = Object.keys(glossary).find(key => key.toLowerCase() === match.toLowerCase()) || match;
          return `<glossary-term data-term="${originalTerm}">${match}</glossary-term>`;
        });
      }
    });
  
    return processedParts.join('');
  };

  const startNewTopic = useCallback(async (topic: string) => {
    setActiveGlobalView('topics');
    setIsLoading(true);
    setLoadingMessage('Generating learning module...');
    setError(null);
    setConversation([]);
    setTopicSummary(null);
    setTopicIllustrationUrl(null);
    setSelectedTopic(topic);
    setActiveMode('read');
    setQuizData(null);
    setPlaygroundScenario(null);
    setScanResults(null);
    setCodeQualityResults(null);
    setPlaygroundFileContent('');
    setInitialPlaygroundFileContent('');
    setUserAnswers([]);
    setCurrentQuestionIndex(0);
    setQuizScore(null);
    // Reset video state
    setIsVideoGenerating(false);
    setTopicExplainerVideoUrl(null);
    setVideoError(null);
    // Reset diagram state
    setTopicDiagramData(null);
    setActiveTooltip(null);

    try {
      if (!glossaryData) {
        await fetchGlossary();
      }
      
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      chatSessionRef.current = ai.chats.create({
        model: 'gemini-2.5-flash',
      });

      const mainContentPrompt = `
        Explain the DevSecOps topic: "${topic}".
        Please structure your explanation in Markdown format with the following sections:
        - A brief, clear introduction to the concept.
        - Why it is important in a DevSecOps lifecycle.
        - Key principles or best practices associated with it.
        - A simple example or analogy to help understanding.
      `;
      
      const mainContentPromise = chatSessionRef.current.sendMessage({ message: mainContentPrompt });

      setLoadingMessage('Creating a visual illustration...');
      const illustrationPrompt = `Generate a clear, infographic-style visual illustration explaining the concept of "${topic}". Use abstract symbols, icons, and arrows to show relationships and flow. The style should be modern, clean, and suitable for a tech learning platform. Text should be minimal or symbolic.`;
      const illustrationPromise = ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: illustrationPrompt }] },
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      setLoadingMessage('Generating interactive diagram...');
      const diagramPrompt = `Generate data for a simple, interactive diagram explaining the DevSecOps topic: "${topic}". The diagram should be representable as a simple linear flow. Return a JSON object. Ensure the nodes are ordered logically in the array to represent the flow.`;
      const diagramPromise = ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: diagramPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              nodes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    label: { type: Type.STRING, description: "A short, user-facing label (max 4 words)." },
                    tooltip: { type: Type.STRING, description: "A one or two-sentence explanation." }
                  },
                  required: ["id", "label", "tooltip"]
                }
              },
              edges: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    from: { type: Type.STRING },
                    to: { type: Type.STRING }
                  },
                  required: ["from", "to"]
                }
              }
            },
            required: ["title", "nodes", "edges"]
          }
        }
      });
      
      const [mainContentResponse, imageResponse, diagramResponse] = await Promise.all([mainContentPromise, illustrationPromise, diagramPromise]);

      // Process main content
      const highlightedMarkdown = highlightGlossaryTerms(mainContentResponse.text, glossaryData || {});
      const parsedHtml = marked.parse(highlightedMarkdown) as string;
      setConversation([{ role: 'model', htmlContent: parsedHtml }]);

      // Process illustration
      for (const part of imageResponse.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64ImageBytes: string = part.inlineData.data;
          const imageUrl = `data:image/png;base64,${base64ImageBytes}`;
          setTopicIllustrationUrl(imageUrl);
          break;
        }
      }

      // Process diagram data
      const diagramData = JSON.parse(diagramResponse.text);
      setTopicDiagramData(diagramData);

      setLoadingMessage('Generating summary...');
      const summaryPrompt = `Based on the DevSecOps topic "${topic}", create a "Key Takeaways and Action Items" section. Use Markdown bullet points. Focus on the most critical points a learner should remember and actionable steps they can take.`;
      const summaryResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: summaryPrompt,
      });
      const parsedSummaryHtml = marked.parse(summaryResponse.text) as string;
      setTopicSummary(parsedSummaryHtml);

    } catch (e) {
      console.error(e);
      setError("Failed to generate content. Please try again.");
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [glossaryData, fetchGlossary]);

  const handleGenerateVideo = async () => {
    if (!selectedTopic) return;
    try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            await window.aistudio.openSelectKey();
             if (!(await window.aistudio.hasSelectedApiKey())) {
                setVideoError("An API key is required to generate videos. Please select one from the dialog and try again.");
                return;
            }
        }

        setIsVideoGenerating(true);
        setVideoError(null);
        setTopicExplainerVideoUrl(null);
        
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        
        const prompt = `Create a short, engaging, silent explainer video for the DevSecOps topic: '${selectedTopic}'. Use simple animations, icons, and minimal text overlays to explain the core concept visually. The style should be modern and clean, like an infographic in motion.`;

        let operation = await ai.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt: prompt,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '16:9'
            }
        });

        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) {
            throw new Error("Video generation succeeded but no download link was provided.");
        }
        
        const videoResponse = await fetch(`${downloadLink}&key=${API_KEY}`);
        if (!videoResponse.ok) {
            throw new Error(`Failed to download video file: ${videoResponse.statusText}`);
        }

        const blob = await videoResponse.blob();
        const videoUrl = URL.createObjectURL(blob);
        
        setTopicExplainerVideoUrl(videoUrl);

    } catch (e) {
        console.error(e);
        let errorMessage = "An unexpected error occurred while generating the video.";
        if (e.message && (e.message.includes("Requested entity was not found") || e.message.includes("API key not valid"))) {
            errorMessage = "Your API key seems to be invalid. Please select a valid key and try again.";
        }
        setVideoError(errorMessage);
    } finally {
        setIsVideoGenerating(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!selectedTopic) return;
    setIsLoading(true);
    setLoadingMessage('Creating a quiz...');
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Generate a 3-question multiple choice quiz about "${selectedTopic}". Each question should have 4 options.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answer: { type: Type.STRING },
                  },
                  required: ["question", "options", "answer"],
                }
              }
            },
            required: ["questions"],
          }
        },
      });
      
      const quiz = JSON.parse(response.text);
      setQuizData(quiz.questions);
      setActiveMode('quiz');
    } catch(e) {
      console.error(e);
      setError("Failed to generate quiz.");
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };
  
  const handleStartPlayground = async () => {
    setIsLoading(true);
    setLoadingMessage('Building a playground scenario...');
    setError(null);
    setScanResults(null);
    setCodeQualityResults(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Create a hands-on playground scenario for a beginner learning about "${selectedTopic}". Provide a scenario description, a filename (e.g., Dockerfile, terraform.tf, Jenkinsfile), and the initial, vulnerable content for that file.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        scenario: { type: Type.STRING },
                        fileName: { type: Type.STRING },
                        initialFileContent: { type: Type.STRING }
                    },
                    required: ["scenario", "fileName", "initialFileContent"],
                }
            }
        });

        const playgroundData = JSON.parse(response.text);
        setPlaygroundScenario(playgroundData.scenario);
        setPlaygroundFileName(playgroundData.fileName);
        setInitialPlaygroundFileContent(playgroundData.initialFileContent);
        setPlaygroundFileContent(playgroundData.initialFileContent);
        setActiveMode('playground');
    } catch(e) {
        console.error(e);
        setError("Failed to generate playground scenario.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const handleSubmitPlayground = async () => {
    if (!playgroundFileContent) return;
    setIsLoading(true);
    setLoadingMessage('Running security scan...');
    setScanResults(null);
    setCodeQualityResults(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const prompt = `
          You are an automated DevSecOps security scanner. Your task is to analyze a user's code submission for vulnerabilities and misconfigurations based on a specific learning topic.

          Learning Topic: "${selectedTopic}"
          Scenario: "${playgroundScenario}"
          
          Initial (vulnerable) File Content:
          \`\`\`
          ${initialPlaygroundFileContent}
          \`\`\`
          
          User's Submitted Solution:
          \`\`\`
          ${playgroundFileContent}
          \`\`\`
          
          Analyze the user's solution. Identify security issues, bad practices, or remaining vulnerabilities.
          For each issue, provide a severity level (CRITICAL, HIGH, MEDIUM, LOW, INFO), a concise title, a clear description of the problem, and an actionable recommendation for how to fix it.

          If the user has fixed all issues and the code is secure according to best practices, return an empty array for the 'findings'.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  findings: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        severity: { type: Type.STRING },
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        recommendation: { type: Type.STRING },
                      },
                      required: ["severity", "title", "description", "recommendation"]
                    }
                  }
                },
                required: ["findings"],
              }
            }
        });

        const results = JSON.parse(response.text);
        setScanResults(results.findings);

        if (selectedTopic) {
          markTopicAsComplete(selectedTopic);
        }
    } catch(e) {
        console.error(e);
        setError("Failed to get feedback for your playground solution.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };
  
  const handleAnalyzeCodeQuality = async () => {
    if (!playgroundFileContent) return;
    setIsLoading(true);
    setLoadingMessage('Analyzing code quality...');
    setScanResults(null);
    setCodeQualityResults(null);
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const prompt = `
        You are a senior software engineer performing a code review. Analyze the provided code snippet for quality, focusing on maintainability, readability, efficiency, and adherence to best practices.

        Learning Topic: "${selectedTopic}"
        File Name: "${playgroundFileName}"

        User's Submitted Code:
        \`\`\`
        ${playgroundFileContent}
        \`\`\`

        Provide feedback as a list of suggestions. For each suggestion, provide:
        1. 'lineNumber': The line number the suggestion applies to.
        2. 'suggestion': A concise description of the suggested improvement.
        3. 'explanation': A brief explanation of why the change is recommended.
        4. 'suggestedCode': The full, corrected line of code that should replace the original line.

        If the code quality is excellent and you have no suggestions, return an empty array for the 'suggestions'.
      `;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lineNumber: { type: Type.NUMBER },
                    suggestion: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    suggestedCode: { type: Type.STRING },
                  },
                  required: ["lineNumber", "suggestion", "explanation", "suggestedCode"]
                }
              }
            },
            required: ["suggestions"],
          }
        }
      });
      const results = JSON.parse(response.text);
      setCodeQualityResults(results.suggestions);
    } catch(e) {
        console.error(e);
        setError("Failed to analyze code quality.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const handleApplySuggestion = (suggestionToApply: CodeQualitySuggestion) => {
    if (!playgroundFileContent) return;

    const lines = playgroundFileContent.split('\n');
    // Ensure the line number is valid
    if (suggestionToApply.lineNumber > 0 && suggestionToApply.lineNumber <= lines.length) {
      lines[suggestionToApply.lineNumber - 1] = suggestionToApply.suggestedCode;
      setPlaygroundFileContent(lines.join('\n'));
    }
  };

  const handleFollowUp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const question = formData.get('question') as string;
    if (!question || !chatSessionRef.current) return;
    
    e.currentTarget.reset();
    
    setConversation(prev => [...prev, {role: 'user', htmlContent: `<p>${question}</p>`}]);
    setIsLoading(true);
    setLoadingMessage('Thinking...');
    
    try {
        const response = await chatSessionRef.current.sendMessage({ message: question });
        const highlightedMarkdown = highlightGlossaryTerms(response.text, glossaryData || {});
        const parsedHtml = marked.parse(highlightedMarkdown) as string;
        setConversation(prev => [...prev, { role: 'model', htmlContent: parsedHtml }]);
    } catch(e) {
        console.error(e);
        setError("Sorry, I couldn't process that question.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  }

  const handleAnswerSelect = (answer: string) => {
    const newAnswers = [...userAnswers];
    newAnswers[currentQuestionIndex] = answer;
    setUserAnswers(newAnswers);

    if (currentQuestionIndex < quizData!.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      let score = 0;
      quizData!.forEach((q, i) => {
        if (newAnswers[i] === q.answer) {
          score++;
        }
      });
      setQuizScore(score);
      if (selectedTopic) {
        markTopicAsComplete(selectedTopic);
      }
    }
  };
  
  const handleGenerateMoreQuizQuestions = async () => {
    if (!selectedTopic || !quizData) return;
    setIsLoading(true);
    setLoadingMessage('Generating more questions...');
    setError(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Generate 3 MORE multiple choice quiz questions about "${selectedTopic}". They should be different from typical introductory questions. Each question should have 4 options.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        questions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    question: { type: Type.STRING },
                                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    answer: { type: Type.STRING },
                                },
                                required: ["question", "options", "answer"],
                            }
                        }
                    },
                    required: ["questions"],
                }
            },
        });

        const moreQuestions = JSON.parse(response.text).questions as QuizQuestion[];
        if (moreQuestions.length > 0) {
            const currentQuizLength = quizData.length;
            setQuizData(prevData => [...(prevData || []), ...moreQuestions]);
            setQuizScore(null); // Go back to quiz mode from results
            setCurrentQuestionIndex(currentQuizLength); // Start at the first new question
        }
    } catch (e) {
        console.error(e);
        setError("Failed to generate more quiz questions.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };
  
  const fetchVulnerabilities = async () => {
    if (vulnerabilityData) return; // Don't re-fetch if data exists
    setIsVulnerabilityLoading(true);
    setVulnerabilityError(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });

        const latestCvesPromise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'List 5 of the most recent, notable CVEs (Common Vulnerabilities and Exposures) from the last 60 days. For each, provide the CVE identifier, a brief, easy-to-understand description for a developer, and its CVSS score (as a number).',
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        cves: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    cveId: { type: Type.STRING },
                                    description: { type: Type.STRING },
                                    cvssScore: { type: Type.NUMBER }
                                },
                                required: ["cveId", "description", "cvssScore"]
                            }
                        }
                    },
                    required: ["cves"]
                }
            }
        });

        const owaspTop10Promise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'List the current OWASP Top 10 vulnerabilities. For each one, provide its identifier (e.g., A01:2021), name, and a one-sentence summary of what it is.',
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        owasp: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    owaspId: { type: Type.STRING },
                                    name: { type: Type.STRING },
                                    summary: { type: Type.STRING }
                                },
                                required: ["owaspId", "name", "summary"]
                            }
                        }
                    },
                    required: ["owasp"]
                }
            }
        });

        const [cveResponse, owaspResponse] = await Promise.all([latestCvesPromise, owaspTop10Promise]);
        
        const cves = JSON.parse(cveResponse.text).cves;
        const owasp = JSON.parse(owaspResponse.text).owasp;
        
        setVulnerabilityData({ latest: cves, owasp: owasp });
    } catch(e) {
        console.error("Failed to fetch vulnerability data:", e);
        setVulnerabilityError("Could not fetch the latest vulnerability data. Please try again later.");
    } finally {
        setIsVulnerabilityLoading(false);
    }
  };

  const fetchNews = async () => {
    if (newsData) return;
    setIsNewsLoading(true);
    setNewsError(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Summarize the latest (last 30 days) news, trends, and notable events in the world of DevSecOps. Provide a concise overview suitable for developers and security professionals.",
            config: {
              tools: [{googleSearch: {}}],
            },
        });
        
        const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => ({
            uri: chunk.web.uri,
            title: chunk.web.title,
        })) || [];
        
        setNewsData({ summary: response.text, sources });

    } catch(e) {
        console.error("Failed to fetch news data:", e);
        setNewsError("Could not fetch the latest news. Please try again later.");
    } finally {
        setIsNewsLoading(false);
    }
  };

  const handleShowVulnerabilityFeed = () => {
    setActiveGlobalView('vulnerabilities');
    setSelectedTopic(null); // Deselect any topic
    fetchVulnerabilities();
  };
  
  const handleShowGlossary = () => {
    setActiveGlobalView('glossary');
    setSelectedTopic(null);
    fetchGlossary();
  };
  
  const handleShowNewsFeed = () => {
    setActiveGlobalView('news');
    setSelectedTopic(null);
    fetchNews();
  };

  const handleShowCertification = () => {
    setActiveGlobalView('certification');
    setSelectedTopic(null);
  };
  
  const handleGenerateCertificationChallenge = async () => {
    setIsLoading(true);
    setLoadingMessage('Generating your final challenge...');
    setError(null);
    setCertificationResult(null);
    setCertificationSolution('');
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `You are a curriculum designer for an advanced DevSecOps course. Create a single, comprehensive final certification challenge for a student who has completed modules on all aspects of DevSecOps, from CI/CD and IaC to container security, threat modeling, and supply chain security. The challenge should be a realistic, multi-faceted scenario that requires the student to synthesize their knowledge. It must ask the student to: 1. Describe a plan or strategy. 2. Provide multiple example configuration files (like Dockerfile, a CI/CD pipeline snippet, or an IaC file). 3. Explain the security considerations and decisions they made.`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  challenge: { type: Type.STRING, description: "The full scenario text in Markdown format." }
                },
                required: ["challenge"],
              }
            }
        });
        const data = JSON.parse(response.text);
        setCertificationChallenge(data.challenge);
    } catch (e) {
        console.error(e);
        setError("Failed to generate the certification challenge. Please try again.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const handleSubmitCertification = async () => {
    if (!certificationChallenge || !certificationSolution) return;
    setIsLoading(true);
    setLoadingMessage('Evaluating your solution...');
    setError(null);
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const prompt = `You are a Senior DevSecOps Architect acting as an expert evaluator for a certification exam. Your task is to review a student's solution to a complex challenge. THE CHALLENGE SCENARIO WAS: --- ${certificationChallenge} --- THE STUDENT'S SUBMITTED SOLUTION IS: --- ${certificationSolution} --- Please evaluate the student's solution based on: Comprehensive Understanding, Security Best Practices, Technical Accuracy, and Clarity. Provide a score from 0 to 100 (passing is 85).`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        score: { type: Type.NUMBER },
                        feedbackSummary: { type: Type.STRING },
                        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                        areasForImprovement: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["score", "feedbackSummary", "strengths", "areasForImprovement"]
                }
            }
        });
        const result = JSON.parse(response.text) as CertificationResult;
        setCertificationResult(result);
    } catch (e) {
        console.error(e);
        setError("Failed to evaluate your solution. Please try again.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const handleExportToPdf = async () => {
    if (!selectedTopic || !exportContentRef.current) return;

    setIsLoading(true);
    setLoadingMessage('Generating PDF...');
    setError(null);

    try {
        // Temporarily modify styles on the original element for cleaner PDF render
        const diagramNodes = exportContentRef.current.querySelectorAll('.diagram-node');
        diagramNodes.forEach(node => ((node as HTMLElement).style.boxShadow = 'none'));

        const canvas = await html2canvas(exportContentRef.current, {
            scale: 2, // Higher scale for better quality
            backgroundColor: '#1e1e1e', // Match surface color
            useCORS: true, // For the illustration image
            onclone: (document) => {
                // Ensure custom elements are styled correctly in the cloned document for canvas
                document.querySelectorAll('glossary-term').forEach(term => {
                    const el = term as HTMLElement;
                    el.style.color = '#bb86fc'; // --secondary-color
                    el.style.borderBottom = '1px dotted #bb86fc';
                    el.style.fontWeight = '500';
                });
            }
        });

        // Restore styles after capture
        diagramNodes.forEach(node => ((node as HTMLElement).style.boxShadow = ''));

        const imgData = canvas.toDataURL('image/png');
        
        // Use jsPDF with pixel dimensions from canvas for a 1:1 render
        const pdf = new jsPDF({
            orientation: 'p',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`${selectedTopic.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_devsecops_academy.pdf`);

    } catch (e) {
        console.error("Failed to generate PDF:", e);
        setError("Could not generate the PDF. Please try again.");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const renderWelcomeMessage = () => (
    <div className="welcome-message">
        <h2>Welcome to the DevSecOps Academy!</h2>
        <p>
            DevSecOps is the practice of integrating security into every stage of the software development lifecycle.
            It's about making security a shared responsibility, not an afterthought.
        </p>
        <p>
            Ready to dive in? <strong>Select a topic from the "Beginner" section on the left to start your journey.</strong>
        </p>
    </div>
  );

  const renderActiveContent = () => {
    if (isLoading && !selectedTopic) {
      return (
        <div className="loader" aria-live="polite">
          <div className="spinner"></div>
          <p>{loadingMessage}</p>
        </div>
      );
    }
    if (error) {
      return <div className="error-message" role="alert">{error}</div>;
    }
    if (!selectedTopic) {
        return renderWelcomeMessage();
    }

    switch (activeMode) {
      case 'quiz':
        return renderQuizMode();
      case 'playground':
        return renderPlaygroundMode();
      case 'read':
      default:
        return renderReadMode();
    }
  };

  const renderVideoExplainer = () => {
    return (
      <div className="explainer-video-container">
        <h3>Video Explainer</h3>
        {videoError && <div className="error-message" role="alert">{videoError}</div>}
        
        {isVideoGenerating && (
          <div className="loader" aria-live="polite">
            <div className="spinner"></div>
            <p>Crafting your video... This may take a minute or two.</p>
          </div>
        )}

        {topicExplainerVideoUrl && !isVideoGenerating && (
          <div className="video-wrapper">
            <video controls title={`Explainer video for ${selectedTopic}`} src={topicExplainerVideoUrl}>
              Your browser does not support the video tag.
            </video>
          </div>
        )}

        {!isVideoGenerating && !topicExplainerVideoUrl && (
          <div className="video-prompt">
            <p>Watch a short animated video to see this concept in action.</p>
             <button onClick={handleGenerateVideo} className="action-button">
              Generate Explainer Video
            </button>
            <p className="video-disclaimer">
              Video generation requires a user-selected API key. 
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer">Billing information</a>.
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderInteractiveDiagram = () => {
    if (isLoading && !topicDiagramData) {
      return (
        <div className="interactive-diagram-container loader" aria-live="polite">
          <div className="spinner"></div>
          <p>{loadingMessage}</p>
        </div>
      );
    }
    if (!topicDiagramData) return null;

    const handleNodeMouseEnter = (event: React.MouseEvent<HTMLDivElement>, node: DiagramNode) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setActiveTooltip({
        content: node.tooltip,
        x: rect.left + window.scrollX + rect.width / 2,
        y: rect.top + window.scrollY - 10, // Position above the node
      });
    };

    const handleNodeMouseLeave = () => {
      setActiveTooltip(null);
    };

    return (
      <div className="interactive-diagram-container">
        <h3 className="diagram-title">{topicDiagramData.title}</h3>
        <div className="diagram-flow">
          {topicDiagramData.nodes.map((node, index) => (
            <React.Fragment key={node.id}>
              <div
                className="diagram-node"
                onMouseEnter={(e) => handleNodeMouseEnter(e, node)}
                onMouseLeave={handleNodeMouseLeave}
                aria-label={`Diagram node: ${node.label}. Hover for details.`}
              >
                {node.label}
              </div>
              {index < topicDiagramData.nodes.length - 1 && <div className="diagram-arrow">→</div>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const renderReadMode = () => (
    <div className="generated-content">
      <div className="exportable-content" ref={exportContentRef}>
        <h2>{selectedTopic}</h2>

        {isLoading && loadingMessage.includes('illustration') && (
          <div className="illustration-container loader" aria-live="polite">
            <div className="spinner"></div>
            <p>{loadingMessage}</p>
          </div>
        )}

        {topicIllustrationUrl && !isLoading && (
          <div className="illustration-container">
            <img src={topicIllustrationUrl} alt={`Illustration for ${selectedTopic}`} />
          </div>
        )}

        {renderInteractiveDiagram()}
        
        <div ref={conversationContentRef}>
          {conversation.map((msg, index) => (
              <div key={index} className={`chat-message ${msg.role}-message`}>
              <div dangerouslySetInnerHTML={{ __html: msg.htmlContent }} />
              </div>
          ))}
        </div>


        {isLoading && loadingMessage.includes('summary') && (
          <div className="loader" aria-live="polite" style={{height: 'auto', margin: '2rem 0'}}>
            <div className="spinner"></div>
            <p>{loadingMessage}</p>
          </div>
        )}

        {topicSummary && (
          <div className="summary-section">
            <h3>Key Takeaways</h3>
            <div dangerouslySetInnerHTML={{ __html: topicSummary }} />
          </div>
        )}
      </div>
      
      {renderVideoExplainer()}

      <div className="follow-up-container">
        <form onSubmit={handleFollowUp}>
          <input name="question" type="text" placeholder="Ask a follow-up question..." aria-label="Ask a follow-up question" required/>
          <button type="submit" className="action-button">Ask</button>
        </form>
      </div>

      <div className="action-buttons">
          <button onClick={handleGenerateQuiz} className="action-button" disabled={isLoading}>Quiz Me!</button>
          <button onClick={handleStartPlayground} className="action-button" disabled={isLoading}>Start Playground</button>
          <button onClick={handleExportToPdf} className="action-button secondary" disabled={isLoading}>
            {isLoading && loadingMessage.includes('PDF') ? 'Generating...' : 'Export as PDF'}
          </button>
      </div>
    </div>
  );

  const renderQuizMode = () => {
    if (!quizData) return isLoading ? (
      <div className="loader" aria-live="polite">
        <div className="spinner"></div>
        <p>{loadingMessage}</p>
      </div>
    ) : null;
    
    if (quizScore !== null) {
      return (
        <div className="quiz-container">
          <h2 style={{ textAlign: 'center' }}>Quiz Results</h2>
          <p style={{ textAlign: 'center', fontSize: '1.2rem', margin: '1rem 0 2rem' }}>
            You scored {quizScore} out of {quizData.length}
          </p>
    
          {quizData.map((q, qIndex) => (
            <div key={qIndex} className="question-review">
              <p>{qIndex + 1}. {q.question}</p>
              <div className="options-review-list">
                {q.options.map((option, oIndex) => {
                  const isCorrectAnswer = option === q.answer;
                  const isUserSelection = option === userAnswers[qIndex];
                  const classNames = ['option-review'];
    
                  if (isCorrectAnswer) {
                    classNames.push('correct');
                  }
                  if (isUserSelection && !isCorrectAnswer) {
                    classNames.push('incorrect');
                  }
    
                  return (
                    <div key={oIndex} className={classNames.join(' ')}>
                      {isUserSelection && <span className="user-selection-indicator">Your choice</span>}
                      {option}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
    
          <div className="action-buttons">
            <button
                onClick={() => setActiveMode('read')}
                className="action-button tertiary"
                disabled={isLoading}
            >
                Back to Topic
            </button>
            <button
                onClick={handleGenerateMoreQuizQuestions}
                className="action-button"
                disabled={isLoading}
            >
                {isLoading ? 'Generating...' : 'Practice with More Questions'}
            </button>
          </div>
        </div>
      );
    }

    const currentQuestion = quizData[currentQuestionIndex];
    return (
      <div className="quiz-container">
        <h2>Quiz: {selectedTopic}</h2>
        <div className="quiz-question">
          <p>{currentQuestionIndex + 1}. {currentQuestion.question}</p>
          <div className="quiz-options">
            {currentQuestion.options.map((option, index) => (
              <label key={index} onClick={() => handleAnswerSelect(option)}>
                <input type="radio" name="option" value={option} checked={userAnswers[currentQuestionIndex] === option} readOnly/>
                {option}
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderPlaygroundMode = () => {
    if(isLoading && !playgroundScenario) {
        return (
            <div className="loader" aria-live="polite">
                <div className="spinner"></div>
                <p>{loadingMessage}</p>
            </div>
        )
    }
    return (
        <div className="playground-container">
            <h2>Playground: {selectedTopic}</h2>
            <div className="playground-layout">
              <div className="playground-scenario">
                <h3>Your Mission</h3>
                <div dangerouslySetInnerHTML={{__html: marked.parse(playgroundScenario || '') as string}}/>
              </div>
              <div className="playground-interactive">
                <div className="playground-file-tab">{playgroundFileName}</div>
                <textarea 
                  className="playground-editor" 
                  value={playgroundFileContent} 
                  onChange={(e) => setPlaygroundFileContent(e.target.value)} 
                  aria-label={`${playgroundFileName} content`}
                  required
                />
                <div className="playground-actions">
                  <button onClick={handleSubmitPlayground} className="action-button" disabled={isLoading}>{isLoading ? 'Scanning...' : 'Run Security Scan'}</button>
                  <button onClick={handleAnalyzeCodeQuality} className="action-button secondary" disabled={isLoading}>{isLoading ? 'Analyzing...' : 'Analyze Code Quality'}</button>
                  <button type="button" className="action-button tertiary" onClick={() => setPlaygroundFileContent(initialPlaygroundFileContent)}>Reset</button>
                </div>
              </div>
            </div>
            
            {isLoading && (scanResults === null && codeQualityResults === null) && (
                 <div className="loader" aria-live="polite" style={{height: 'auto', margin: '2rem 0'}}>
                    <div className="spinner"></div>
                    <p>{loadingMessage}</p>
                </div>
            )}

            {scanResults && (
                <div className="scan-results-container">
                    <h3>Security Scan Results</h3>
                    {scanResults.length === 0 ? (
                        <div className="scan-results-success">
                            <p>✅ All checks passed! No vulnerabilities found.</p>
                        </div>
                    ) : (
                        <div className="scan-findings-list">
                            {scanResults.map((finding, index) => (
                                <div key={index} className="scan-finding-card">
                                    <div className="finding-header">
                                        <span className="severity-badge" data-severity={finding.severity}>{finding.severity}</span>
                                        <h4 className="finding-title">{finding.title}</h4>
                                    </div>
                                    <div className="finding-details">
                                        <p><strong>Description:</strong> {finding.description}</p>
                                        <p><strong>Recommendation:</strong> {finding.recommendation}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {codeQualityResults && (
              <div className="code-quality-results-container">
                <h3>Code Quality Analysis</h3>
                {codeQualityResults.length === 0 ? (
                  <div className="code-quality-success">
                    <p>✨ Great job! The code quality looks excellent.</p>
                  </div>
                ) : (
                  <div className="code-quality-suggestions-list">
                    {codeQualityResults.map((item, index) => (
                      <div key={index} className="code-quality-suggestion-card">
                        <div className="suggestion-header">
                          <span className="line-number-badge">Line {item.lineNumber}</span>
                          <h4 className="suggestion-title">{item.suggestion}</h4>
                        </div>
                        <div className="suggestion-details">
                          <p><strong>Explanation:</strong> {item.explanation}</p>
                          <button onClick={() => handleApplySuggestion(item)} className="apply-suggestion-button">
                            Apply Fix
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            <button onClick={() => setActiveMode('read')} className="action-button" style={{marginTop: '2rem'}}>Back to Topic</button>
        </div>
    );
  }
  
  const getCvssSeverity = (score: number) => {
    if (score >= 9.0) return 'CRITICAL';
    if (score >= 7.0) return 'HIGH';
    if (score >= 4.0) return 'MEDIUM';
    if (score >= 0.1) return 'LOW';
    return 'INFO';
  };

  const renderVulnerabilityFeed = () => {
    if (isVulnerabilityLoading) {
      return (
        <div className="loader" aria-live="polite">
          <div className="spinner"></div>
          <p>Fetching latest threat intelligence...</p>
        </div>
      );
    }
    if (vulnerabilityError) {
      return <div className="error-message" role="alert">{vulnerabilityError}</div>;
    }
    if (!vulnerabilityData) {
      return <div className="welcome-message"><p>Select a feed to view vulnerabilities.</p></div>
    }

    const currentData = activeVulnerabilityTab === 'latest' ? vulnerabilityData.latest : vulnerabilityData.owasp;

    return (
      <div className="vulnerability-feed-container">
        <h2>Live Vulnerability Feed</h2>
        <div className="vuln-tabs">
          <button onClick={() => setActiveVulnerabilityTab('latest')} className={activeVulnerabilityTab === 'latest' ? 'active' : ''}>Latest CVEs</button>
          <button onClick={() => setActiveVulnerabilityTab('owasp')} className={activeVulnerabilityTab === 'owasp' ? 'active' : ''}>OWASP Top 10</button>
        </div>
        <div className="vuln-card-list">
          {activeVulnerabilityTab === 'latest' ? (
            (currentData as CVE[]).map((vuln) => (
              <div key={vuln.cveId} className="vuln-card">
                <div className="vuln-card-header">
                  <h3>{vuln.cveId}</h3>
                  <span className="severity-badge" data-severity={getCvssSeverity(vuln.cvssScore)}>
                    {getCvssSeverity(vuln.cvssScore)} ({vuln.cvssScore.toFixed(1)})
                  </span>
                </div>
                <div className="vuln-card-body">
                  <p>{vuln.description}</p>
                </div>
              </div>
            ))
          ) : (
             (currentData as OWASP[]).map((vuln) => (
              <div key={vuln.owaspId} className="vuln-card">
                <div className="vuln-card-header">
                  <h3>{vuln.name}</h3>
                   <span className="owasp-id-badge">{vuln.owaspId}</span>
                </div>
                <div className="vuln-card-body">
                  <p>{vuln.summary}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };
  
  const renderGlossaryView = () => {
    if (isGlossaryLoading) {
      return (
        <div className="loader" aria-live="polite">
          <div className="spinner"></div>
          <p>Loading glossary...</p>
        </div>
      );
    }
    if (glossaryError) {
      return <div className="error-message" role="alert">{glossaryError}</div>;
    }
    if (!glossaryData) {
      return <div className="welcome-message"><p>Glossary is being prepared.</p></div>;
    }

    const filteredTerms = Object.entries(glossaryData)
        .filter(([term, definition]) => 
            term.toLowerCase().includes(glossarySearchTerm.toLowerCase()) || 
            definition.toLowerCase().includes(glossarySearchTerm.toLowerCase())
        )
        .sort((a, b) => a[0].localeCompare(b[0]));

    return (
        <div className="glossary-container">
            <h2>DevSecOps Glossary</h2>
            <div className="search-container" style={{marginBottom: '2rem'}}>
                <input
                    type="search"
                    className="search-input"
                    placeholder="Search terms or definitions..."
                    aria-label="Search glossary"
                    value={glossarySearchTerm}
                    onChange={(e) => setGlossarySearchTerm(e.target.value)}
                />
            </div>
            {filteredTerms.length > 0 ? (
                <div className="glossary-list">
                    {filteredTerms.map(([term, definition]) => (
                        <div key={term} className="glossary-item">
                            <h3 className="glossary-term-title">{term}</h3>
                            <p className="glossary-term-definition">{definition}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="no-results-message">No matching terms found.</p>
            )}
        </div>
    );
  };

  const renderNewsFeed = () => {
    if (isNewsLoading) {
      return (
        <div className="loader" aria-live="polite">
          <div className="spinner"></div>
          <p>Searching for the latest DevSecOps news...</p>
        </div>
      );
    }
    if (newsError) {
      return <div className="error-message" role="alert">{newsError}</div>;
    }
    if (!newsData) {
      return <div className="welcome-message"><p>Click the button in the sidebar to fetch the latest news.</p></div>
    }

    return (
      <div className="news-feed-container">
        <h2>DevSecOps in the News</h2>
        <div className="news-summary" dangerouslySetInnerHTML={{ __html: marked.parse(newsData.summary) as string }}/>
        
        {newsData.sources.length > 0 && (
          <div className="news-sources">
            <h3>Sources</h3>
            <ul>
              {newsData.sources.map((source, index) => (
                 <li key={index}>
                    <a href={source.uri} target="_blank" rel="noopener noreferrer">
                      {source.title || source.uri}
                    </a>
                 </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderCertificationView = () => {
    if (isLoading) {
      return (
        <div className="loader" aria-live="polite">
          <div className="spinner"></div>
          <p>{loadingMessage}</p>
        </div>
      );
    }
    if (error) {
        return <div className="error-message" role="alert">{error}</div>;
    }

    if (certificationResult) {
      const isPass = certificationResult.score >= 85;
      return (
        <div className="certification-container">
          <h2>Certification Results</h2>
          <div className={`certification-results-view ${isPass ? 'pass' : 'fail'}`}>
              <div className="certification-score">
                  <span>Your Score</span>
                  <div className="score-value">{certificationResult.score}</div>
                  <div className="score-status">{isPass ? "Mastery Achieved" : "Needs Improvement"}</div>
              </div>
              <div className="certification-feedback">
                  <p>{certificationResult.feedbackSummary}</p>
                  <h3>Strengths</h3>
                  <ul>
                      {certificationResult.strengths.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                  <h3>Areas for Improvement</h3>
                  <ul>
                      {certificationResult.areasForImprovement.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
              </div>
          </div>
          {isPass && (
            <div className="certificate-of-mastery">
              <div className="certificate-header">
                <h2>Certificate of Mastery</h2>
                <div className="certificate-seal">🏆</div>
              </div>
              <p className="certificate-body">
                This certifies that a <strong>DevSecOps Expert</strong> has successfully completed the DevSecOps Academy curriculum and demonstrated comprehensive knowledge and practical skills by passing the final certification challenge.
              </p>
              <p className="certificate-date">
                Issued on: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          )}
          <div className="action-buttons">
            <button onClick={handleGenerateCertificationChallenge} className="action-button">
              {isPass ? 'Try a Different Challenge' : 'Try Again'}
            </button>
          </div>
        </div>
      );
    }

    if (certificationChallenge) {
        return (
            <div className="certification-container">
                <h2>Your Final Challenge</h2>
                <div className="certification-challenge-view">
                    <div className="certification-scenario" dangerouslySetInnerHTML={{ __html: marked.parse(certificationChallenge) }} />
                    <div className="certification-solution">
                        <h3>Your Solution</h3>
                        <p>Address all points from the scenario. Provide code snippets and explanations in the text area below.</p>
                        <textarea
                            className="certification-solution-editor"
                            value={certificationSolution}
                            onChange={(e) => setCertificationSolution(e.target.value)}
                            placeholder="Enter your comprehensive solution here..."
                            aria-label="Certification solution editor"
                        />
                        <div className="action-buttons">
                            <button onClick={handleSubmitCertification} className="action-button" disabled={!certificationSolution}>
                                Submit for Review
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="certification-container">
            <div className="certification-intro">
                <h2>Final Certification Challenge</h2>
                <p>This is the final step in your journey. You will be presented with a complex, real-world scenario that requires you to synthesize knowledge from across the entire curriculum.</p>
                <p>An AI-powered Senior DevSecOps Architect will evaluate your solution and provide detailed feedback. Pass the challenge to earn your Certificate of Mastery.</p>
                <button onClick={handleGenerateCertificationChallenge} className="action-button">
                    Generate Your Challenge
                </button>
            </div>
        </div>
    );
  };
  
  const completedCount = Object.keys(completedTopics).length;
  const progressPercentage = TOTAL_TOPICS > 0 ? (completedCount / TOTAL_TOPICS) * 100 : 0;
  
  const remainingTopics = TOTAL_TOPICS - completedCount;
  const weeksToGo = remainingTopics > 0 && learningRate > 0 ? remainingTopics / learningRate : 0;
  const estimatedDate = new Date();
  estimatedDate.setDate(estimatedDate.getDate() + weeksToGo * 7);
  const formattedDate = estimatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });


  const renderLearningPace = () => {
    if (remainingTopics <= 0) {
      return (
        <div className="learning-pace-tracker">
          <div className="estimate-result all-complete">
            🎉 <strong>Congratulations!</strong> You've completed all topics! 🎉
          </div>
        </div>
      )
    }

    return (
      <div className="learning-pace-tracker">
        <div className="pace-label-wrapper">
          <label htmlFor="learning-rate">Set Your Learning Pace</label>
          <div className="info-tooltip-wrapper">
            <span className="info-icon">ⓘ</span>
            <div className="info-tooltip">
              This estimate is calculated based on the number of remaining topics divided by your selected weekly learning rate.
            </div>
          </div>
        </div>
        <select 
            id="learning-rate" 
            className="pace-select"
            value={learningRate} 
            onChange={(e) => setLearningRate(Number(e.target.value))}
        >
          {Object.entries(LEARNING_RATES).map(([rate, label]) => (
            <option key={rate} value={rate}>{label}</option>
          ))}
        </select>
        <div className="estimate-result">
            <span className="estimate-prefix">Est. Completion Date</span>
            <span className="estimate-date">{formattedDate}</span>
        </div>
      </div>
    );
  };
  
  const renderBookmarkedTopics = () => {
    const bookmarks = Object.keys(bookmarkedTopics)
      .filter(topic => bookmarkedTopics[topic])
      .filter(topic => topic.toLowerCase().includes(searchTerm.toLowerCase()));
      
    if (bookmarks.length === 0) return null;

    return (
        <div className="bookmarked-topics-section">
            <h3>Bookmarked Topics</h3>
            <div className="topic-buttons">
            {bookmarks.map((topic) => (
                <button
                    key={topic}
                    onClick={() => startNewTopic(topic)}
                    className={`topic-button ${selectedTopic === topic ? 'selected' : ''} ${completedTopics[topic] ? 'completed' : ''}`}
                    aria-pressed={selectedTopic === topic}
                >
                    <div className="topic-header">
                        <span className="topic-title">{topic}</span>
                        <span 
                            className={`bookmark-icon ${bookmarkedTopics[topic] ? 'bookmarked' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleBookmark(topic);
                            }}
                            role="button"
                            aria-label={`Remove ${topic} from bookmarks`}
                            aria-pressed={true}
                        >
                            ★
                        </span>
                    </div>
                </button>
            ))}
            </div>
        </div>
    );
  };
  
  const renderTopicsForReview = () => {
    const reviewTopics = Object.keys(topicsForReview)
        .filter(topic => topicsForReview[topic] && topic.toLowerCase().includes(searchTerm.toLowerCase()));

    if (reviewTopics.length === 0) return null;

    return (
        <div className="review-topics-section">
            <h3>Ready for Review</h3>
            <div className="topic-buttons">
                {reviewTopics.map((topic) => (
                    <button
                        key={topic}
                        onClick={() => startNewTopic(topic)}
                        className={`topic-button ${selectedTopic === topic ? 'selected' : ''} ${completedTopics[topic] ? 'completed' : ''} review-due`}
                        aria-pressed={selectedTopic === topic}
                    >
                        <div className="topic-header">
                            <span className="topic-title">{topic}</span>
                             <span
                                className={`bookmark-icon ${bookmarkedTopics[topic] ? 'bookmarked' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleBookmark(topic);
                                }}
                                role="button"
                                aria-label={bookmarkedTopics[topic] ? `Remove ${topic} from bookmarks` : `Bookmark ${topic}`}
                                aria-pressed={!!bookmarkedTopics[topic]}
                            >
                                ★
                            </span>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
  };
  
  const allFilteredTopics = ALL_TOPICS_FLAT.filter(topic => topic.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredBookmarks = Object.keys(bookmarkedTopics).filter(topic => bookmarkedTopics[topic] && topic.toLowerCase().includes(searchTerm.toLowerCase()));


  return (
    <main>
      <header>
        <h1>DevSecOps Academy</h1>
        <p>Start your journey into secure software development.</p>
      </header>
      <div className="container">
        <aside className="topics-container" aria-label="Learning Topics">
           <div className="search-container">
            <input
              type="search"
              className="search-input"
              placeholder="Search topics..."
              aria-label="Search learning topics"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="progress-tracker">
            <p><strong>Overall Progress:</strong> {completedCount} / {TOTAL_TOPICS} completed</p>
            <div className="progress-bar-container" role="progressbar" aria-valuenow={progressPercentage} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-bar-fill" style={{width: `${progressPercentage}%`}}></div>
            </div>
          </div>

          {renderLearningPace()}

           <div className="sidebar-actions">
               <button className="sidebar-action-button" onClick={handleShowNewsFeed}>
                DevSecOps in the News
              </button>
              <button className="sidebar-action-button" onClick={handleShowVulnerabilityFeed}>
                Live Vulnerability Feed
              </button>
              <button className="sidebar-action-button" onClick={handleShowGlossary}>
                Glossary
              </button>
              <button 
                className="sidebar-action-button certification" 
                onClick={handleShowCertification}
                disabled={progressPercentage < 75}
                title={progressPercentage < 75 ? 'Complete 75% of topics to unlock' : 'Take the final challenge'}
                >
                Final Certification Challenge
              </button>
           </div>
          
          {renderTopicsForReview()}
          {renderBookmarkedTopics()}

          {Object.entries(TOPICS).map(([level, topics]) => {
             const filteredTopics = topics.filter(topic => topic.toLowerCase().includes(searchTerm.toLowerCase()));
             if (filteredTopics.length === 0) return null;

             const levelTitle = level.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());


             return (
               <div className="topic-section" key={level}>
                <h3>{levelTitle}</h3>
                <div className="topic-buttons">
                  {filteredTopics.map((topic) => (
                    <button
                      key={topic}
                      onClick={() => startNewTopic(topic)}
                      className={`topic-button ${selectedTopic === topic ? 'selected' : ''} ${completedTopics[topic] ? 'completed' : ''} ${topicsForReview[topic] ? 'review-due' : ''}`}
                      aria-pressed={selectedTopic === topic}
                      disabled={Object.keys(topicDescriptions).length === 0}
                    >
                      <div className="topic-header">
                          <span className="topic-title">{topic}</span>
                          <span
                              className={`bookmark-icon ${bookmarkedTopics[topic] ? 'bookmarked' : ''}`}
                              onClick={(e) => {
                                  e.stopPropagation();
                                  toggleBookmark(topic);
                              }}
                              role="button"
                              aria-label={bookmarkedTopics[topic] ? `Remove ${topic} from bookmarks` : `Bookmark ${topic}`}
                              aria-pressed={!!bookmarkedTopics[topic]}
                          >
                              ★
                          </span>
                      </div>
                      <span className="topic-description">{topicDescriptions[topic] || 'Loading description...'}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          
          {searchTerm && allFilteredTopics.length === 0 && filteredBookmarks.length === 0 && (
            <p className="no-results-message">No topics found.</p>
          )}
        </aside>
        <section className="content-container" aria-live="polite">
          {activeGlobalView === 'topics' && renderActiveContent()}
          {activeGlobalView === 'vulnerabilities' && renderVulnerabilityFeed()}
          {activeGlobalView === 'glossary' && renderGlossaryView()}
          {activeGlobalView === 'news' && renderNewsFeed()}
          {activeGlobalView === 'certification' && renderCertificationView()}
          {activeTooltip && (
            <div className="diagram-tooltip" style={{ top: `${activeTooltip.y}px`, left: `${activeTooltip.x}px` }}>
              {activeTooltip.content}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(<App />);